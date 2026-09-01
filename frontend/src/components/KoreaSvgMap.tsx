"use client";

import type {
  AdminLayer,
  AdminLevel,
  AdminRegion,
  DailyMlRisk,
  FireEvent,
  MapData,
  MapDisplayMode,
  MountainInfo,
  RegionStat,
  RiskMode,
  SigunguMlScores,
} from "@/lib/types";
import { intensityToColor, probToColor } from "@/lib/choropleth";
import { readApiJson } from "@/lib/apiJson";
import {
  KAKAO_MAX_LEVEL,
  clampToKorea,
  kakaoToSvgView,
  svgToWgs84,
  svgViewToKakao,
  viewFromCenterSvg,
  wgs84ToSvg,
} from "@/lib/svgProjection";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@/lib/authContext";
import { DailyPredictForm } from "./DailyPredictForm";
import { ScenarioPredictForm } from "./ScenarioPredictForm";
import { FireHistoryPanel } from "./FireHistoryPanel";
import { useHistorySync } from "./HistorySyncControl";
import { MapLegend } from "./MapLegend";
import { MapChrome } from "./MapChrome";
import { AuthModal } from "./AuthModal";
import { AppSidebar } from "./AppSidebar";
import { MountainSearchResult } from "./MountainSearchResult";
import { SatelliteMap, type SatelliteViewState } from "./SatelliteMap";
import {
  linkMountainToRegions,
  type MountainRegionLink,
} from "@/lib/mountainSearch";
import { eventMatchesSelection, findAdminForFireEvent, stripAdmin } from "@/lib/adminMatch";
import {
  fontSizeForRing,
  largestRing,
  visualCenterFromPath,
} from "@/lib/svgLabelLayout";

type Props = {
  mapData: MapData;
  layers: {
    sido: AdminLayer;
    sigungu: AdminLayer;
    emd: AdminLayer;
  };
  mlScores?: SigunguMlScores | null;
};

type View = { scale: number; tx: number; ty: number };

const MIN_SCALE = 1;
const MAX_SCALE = 37;
const INITIAL_VIEW: View = { scale: 1, tx: 0, ty: 0 };
/** 이 픽셀 이상 움직이면 팬으로 간주 (클릭 아님) */
const PAN_THRESHOLD_PX = 5;

/**
 * 지역 선택 시 나머지 흐림 세기 (0~1, 클수록 진함)
 * 직접 숫자만 바꿔가며 조절하면 됨.
 */
const SELECT_DIM = {
  /** 선택되지 않은 지역 fill */
  fill: 0.58,
  /** 읍면동 fill (조금 더 옅게) */
  fillEmd: 0.52,
  /** 선택 중 다른 지역에 호버했을 때 fill */
  fillHover: 0.78,
  /** 선택되지 않은 지역 stroke */
  stroke: 0.55,
  strokeEmd: 0.32,
  strokeHover: 0.7,
  /** 선택되지 않은 라벨 */
  label: 0.55,
  labelStroke: 0.5,
} as const;

function levelForScale(scale: number): AdminLevel {
  if (scale < 4.5) return "sido";
  if (scale < 11) return "sigungu";
  return "emd";
}

/** 위성: 카카오 레벨이 작을수록 확대. Lv.9 이하에서 읍면동, 바깥은 시군구 색을 유지. */
function levelForKakaoZoom(kakaoLevel: number): AdminLevel {
  if (kakaoLevel >= 12) return "sido";
  if (kakaoLevel >= 10) return "sigungu";
  return "emd";
}

const LEVEL_LABEL: Record<string, string> = {
  sido: "시도",
  sigungu: "시군구",
  emd: "읍면동",
};

const LEVEL_UNIT: Record<string, string> = {
  sido: "시·도 단위",
  sigungu: "시·군·구 단위",
  emd: "읍·면·동 단위",
};

function clientToSvg(
  svg: SVGSVGElement,
  clientX: number,
  clientY: number,
): { x: number; y: number } {
  const pt = svg.createSVGPoint();
  pt.x = clientX;
  pt.y = clientY;
  const ctm = svg.getScreenCTM();
  if (!ctm) return { x: 0, y: 0 };
  const p = pt.matrixTransform(ctm.inverse());
  return { x: p.x, y: p.y };
}

function stripName(name: string) {
  return stripAdmin(name);
}

/** 여러 시군구의 산도감·산 건수를 하나로 합침 */
function mergeMountainCatalogs(parts: RegionStat[]): {
  mountain_count: number;
  catalog_mountains: MountainInfo[];
  top_mountains: MountainInfo[];
} {
  let mountain_count = 0;
  const catalog: MountainInfo[] = [];
  const top: MountainInfo[] = [];
  const seenCat = new Set<string>();
  const seenTop = new Set<string>();

  for (const r of parts) {
    mountain_count += r.mountain_count ?? 0;
    for (const m of r.catalog_mountains ?? []) {
      const id = m.id || m.name;
      if (seenCat.has(id)) continue;
      seenCat.add(id);
      catalog.push(m);
    }
    for (const m of r.top_mountains ?? []) {
      const id = m.id || m.name;
      if (seenTop.has(id)) continue;
      seenTop.add(id);
      top.push(m);
    }
  }

  catalog.sort(
    (a, b) =>
      (b.height ?? 0) - (a.height ?? 0) || a.name.localeCompare(b.name, "ko"),
  );
  top.sort(
    (a, b) =>
      b.fire_count - a.fire_count || a.name.localeCompare(b.name, "ko"),
  );

  return {
    mountain_count,
    catalog_mountains: catalog.slice(0, 24),
    top_mountains: top.slice(0, 12),
  };
}

function shortLabel(name: string, level: AdminLevel) {
  if (level === "sido") {
    const short = name
      .replace("특별자치시", "")
      .replace("특별자치도", "")
      .replace("광역시", "")
      .replace("특별시", "")
      .replace("도", "")
      .replace("전남광주통합", "전남·광주");
    const SIDO_SHORT: Record<string, string> = {
      충청남: "충남",
      충청북: "충북",
      경상북: "경북",
      경상남: "경남",
      전라남: "전남",
      전라북: "전북",
    };
    return SIDO_SHORT[short] ?? short;
  }
  // 세종특별자치시 → 세종. "청주시 흥덕구" 같은 구 접미는 유지.
  if (/특별자치시$/.test(name)) return name.replace("특별자치시", "");
  return name;
}

/** 시도 라벨 중 도 단위(경기·경북 등). 광역시·특별시는 false */
function isProvinceSido(name: string): boolean {
  if (/전남광주통합/.test(name)) return true;
  if (/(광역시|특별시|특별자치시)/.test(name) && !/도/.test(name)) {
    return false;
  }
  return /도/.test(name);
}

/**
 * 시도 라벨: 도청 좌표는 이웃 시·도 경계에 붙으므로
 * 캡처 기준 어색한 5곳은 폴리곤 안쪽 시각 중심으로 고정.
 * 경기는 서울을 감싸서 자동 중심이 서울과 겹침 → 동쪽(양평 쪽).
 */
const SIDO_LABEL_CENTER: Record<string, [number, number]> = {
  "51": [406, 172], // 강원
  "41": [324, 200], // 경기
  "43": [350, 308], // 충북
  "48": [385, 525], // 경남
  "12": [262, 582], // 전남·광주
};

type RegionLabelLayout = { x: number; y: number; fs: number };

/** 가장 큰 육지 링 기준 라벨 위치·글자 크기 (섬·돌출부 bbox에 끌리지 않음). */
function regionLabelLayout(
  regions: AdminRegion[],
  level: AdminLevel,
  scale: number,
): Map<string, RegionLabelLayout> {
  const layout = new Map<string, RegionLabelLayout>();
  if (level === "emd") return layout;

  const zoomFs =
    level === "sido"
      ? Math.max(7.5, 10.5 / Math.sqrt(scale))
      : Math.max(5.6, 7.2 / Math.sqrt(scale));

  for (const r of regions) {
    const text = shortLabel(r.name, level);
    const provinceLabel = level === "sido" && isProvinceSido(r.name);
    const ring = r.d ? largestRing(r.d, r.code) : null;
    const override = level === "sido" ? SIDO_LABEL_CENTER[r.code] : undefined;
    const center =
      override ??
      (level === "sido"
        ? r.label
        : (visualCenterFromPath(r.d, r.code) ?? r.label));
    let fs = provinceLabel ? zoomFs * 1.8 : zoomFs;
    if (!provinceLabel) {
      fs = fontSizeForRing(ring, text, zoomFs);
    }
    layout.set(r.code, { x: center[0], y: center[1], fs });
  }
  return layout;
}

export function KoreaSvgMap({
  mapData: mapDataProp,
  layers: layersProp,
  mlScores,
}: Props) {
  const stageRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [mapData, setMapData] = useState<MapData>(mapDataProp);
  const [layers, setLayers] = useState(layersProp);
  const [selected, setSelected] = useState<RegionStat | null>(null);
  const [selectedAdmin, setSelectedAdmin] = useState<AdminRegion | null>(null);
  const [hovered, setHovered] = useState<AdminRegion | null>(null);
  const [view, setView] = useState<View>(INITIAL_VIEW);
  const [mapMode, setMapMode] = useState<MapDisplayMode>("choropleth");
  const [rightPanelOpen, setRightPanelOpen] = useState(true);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [satView, setSatView] = useState<SatelliteViewState>(() =>
    svgViewToKakao(INITIAL_VIEW),
  );
  const [satSyncKey, setSatSyncKey] = useState(0);
  const [riskMode, setRiskMode] = useState<RiskMode>("daily");
  const [daily, setDaily] = useState<DailyMlRisk | null>(null);
  const [scenario, setScenario] = useState<DailyMlRisk | null>(null);
  const [predictLoading, setPredictLoading] = useState(false);
  const [predictError, setPredictError] = useState<string | null>(null);
  const [authModal, setAuthModal] = useState<"login" | "register" | null>(null);
  const { oauthError, clearOauthError } = useAuth();
  useEffect(() => {
    if (oauthError) setAuthModal("login");
  }, [oauthError]);
  /** 지도 마커용 (검색·산도감 공통) */
  const [pinnedMountain, setPinnedMountain] = useState<MountainInfo | null>(
    null,
  );
  const [pinnedFire, setPinnedFire] = useState<{
    x: number;
    y: number;
    label: string;
  } | null>(null);
  /** 검색바로 열었을 때만 우측 검색 결과 패널 표시 */
  const [searchPanelMountain, setSearchPanelMountain] =
    useState<MountainInfo | null>(null);
  const [mountainLink, setMountainLink] = useState<MountainRegionLink | null>(
    null,
  );
  const viewRef = useRef(view);
  viewRef.current = view;
  const mapModeRef = useRef(mapMode);
  mapModeRef.current = mapMode;
  const predictInFlight = useRef<Promise<DailyMlRisk | null> | null>(null);
  const panRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    originTx: number;
    originTy: number;
    moved: boolean;
  } | null>(null);
  const suppressClickRef = useRef(false);
  const [isPanning, setIsPanning] = useState(false);

  useEffect(() => {
    setMapData(mapDataProp);
  }, [mapDataProp]);
  useEffect(() => {
    setLayers(layersProp);
  }, [layersProp]);

  const fetchKmaPredict = useCallback(async (force = false) => {
    if (!force && predictInFlight.current) {
      return predictInFlight.current;
    }
    setPredictLoading(true);
    setPredictError(null);
    const job = (async () => {
      try {
        const res = await fetch("/api/predict/daily", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ source: "kma", force }),
        });
        const json = await readApiJson(res);
        if (!res.ok || !json.ok) {
          throw new Error(json.error || "기상청 예측 실패");
        }
        const data = json.data as DailyMlRisk;
        setDaily(data);
        setPredictError(null);
        return data;
      } catch {
        setPredictError(
          "당일 예측에 실패했습니다. 기상청 관측을 불러오지 못했습니다.",
        );
        return null;
      } finally {
        setPredictLoading(false);
        predictInFlight.current = null;
      }
    })();
    predictInFlight.current = job;
    return job;
  }, []);

  useEffect(() => {
    if (riskMode === "daily" && !daily && !predictLoading && !predictError) {
      void fetchKmaPredict(false);
    }
  }, [riskMode, daily, predictLoading, predictError, fetchKmaPredict]);

  const level =
    mapMode === "satellite"
      ? levelForKakaoZoom(satView.level)
      : levelForScale(view.scale);
  const activeLayer =
    level === "sido"
      ? layers.sido
      : level === "sigungu"
        ? layers.sigungu
        : layers.emd;

  const labelLayout = useMemo(
    () => regionLabelLayout(activeLayer.regions, level, view.scale),
    [activeLayer.regions, level, view.scale],
  );

  const sigunguByCode = useMemo(() => {
    const m = new Map<string, AdminRegion>();
    for (const r of layers.sigungu.regions) m.set(r.code, r);
    return m;
  }, [layers.sigungu]);

  const dailyByCode = useMemo(() => {
    const m = new Map<string, { norm: number; raw: number }>();
    for (const r of daily?.regions ?? []) {
      m.set(String(r.code), {
        norm: r.ml_risk_norm,
        raw: r.ml_risk,
      });
    }
    return m;
  }, [daily]);

  const scenarioByCode = useMemo(() => {
    const m = new Map<string, { norm: number; raw: number }>();
    for (const r of scenario?.regions ?? []) {
      m.set(String(r.code), {
        norm: r.ml_risk_norm,
        raw: r.ml_risk,
      });
    }
    return m;
  }, [scenario]);

  const activePredict = riskMode === "scenario" ? scenario : daily;
  const activeByCode = riskMode === "scenario" ? scenarioByCode : dailyByCode;
  const isPredictMode = riskMode === "daily" || riskMode === "scenario";
  const blankDailyMap = riskMode === "daily" && !daily;
  const blankPredictMap =
    (riskMode === "daily" && !daily) || (riskMode === "scenario" && !scenario);

  /** 시도: 하위 시군구 평균 / 읍면동: 상위 시군구 */
  const scoreForRegion = useCallback(
    (
      r: AdminRegion,
      lvl: AdminLevel,
      byCode: Map<string, { norm: number; raw: number }>,
      useNorm: boolean,
    ): number | null => {
      if (!byCode.size) return null;
      const pick = (code: string) => {
        const v = byCode.get(code);
        if (!v) return null;
        return useNorm ? v.norm : v.raw;
      };
      if (lvl === "sigungu") return pick(r.code);
      if (lvl === "emd") return pick(r.code.slice(0, 5));
      const vals: number[] = [];
      for (const s of layers.sigungu.regions) {
        if (s.province === r.province) {
          const v = pick(s.code);
          if (v != null) vals.push(v);
        }
      }
      if (!vals.length) return null;
      return vals.reduce((a, b) => a + b, 0) / vals.length;
    },
    [layers.sigungu],
  );

  /** 지도 색용 수치 0~1 (당일/시나리오=절대 확률, 이력=상대 빈도) */
  const colorProb = useCallback(
    (r: AdminRegion, lvl: AdminLevel): number => {
      if (isPredictMode) {
        const v = scoreForRegion(r, lvl, activeByCode, false);
        if (v != null) return v;
      }
      return r.prob;
    },
    [isPredictMode, scoreForRegion, activeByCode],
  );

  /** 당일/시나리오 UI용 원확률. 이력 모드에서는 쓰지 않음(건수만 표시). */
  const labelProb = useCallback(
    (r: AdminRegion, lvl: AdminLevel): number | null => {
      if (!isPredictMode) return null;
      return scoreForRegion(r, lvl, activeByCode, false);
    },
    [isPredictMode, scoreForRegion, activeByCode],
  );

  const fillOf = useCallback(
    (r: AdminRegion, lvl: AdminLevel = level) => {
      if (
        (riskMode === "daily" && !daily) ||
        (riskMode === "scenario" && !scenario)
      ) {
        return "#ffffff";
      }
      const v = colorProb(r, lvl);
      return isPredictMode ? probToColor(v) : intensityToColor(v);
    },
    [colorProb, daily, isPredictMode, level, riskMode, scenario],
  );

  const parentSigungu = useMemo(() => {
    const code = hovered?.code ?? selectedAdmin?.code;
    if (!code || level !== "emd" || code.length < 5) return null;
    return sigunguByCode.get(code.slice(0, 5)) ?? null;
  }, [hovered, selectedAdmin, level, sigunguByCode]);

  const regionList = mapData.regions?.length
    ? mapData.regions
    : mapData.provinces;

  const byName = useMemo(() => {
    const m = new Map<string, RegionStat>();
    for (const r of regionList) {
      if (!r.province) continue;
      m.set(`${r.province}|${stripName(r.name)}`, r);
      m.set(`${r.province}|${r.name}`, r);
    }
    return m;
  }, [regionList]);

  const allHistoryEvents = useMemo(() => {
    const merged: FireEvent[] = [];
    const seen = new Set<string>();
    for (const list of Object.values(mapData.history || {})) {
      for (const ev of list) {
        const id = `${ev.datetime}|${ev.region}|${ev.damage_area}`;
        if (seen.has(id)) continue;
        seen.add(id);
        merged.push(ev);
      }
    }
    return merged;
  }, [mapData.history]);

  const eventsForSelection = useMemo(() => {
    if (!selected) return [] as FireEvent[];
    const admin = selectedAdmin;
    const atLevel: AdminLevel = admin ? level : "sigungu";
    const name = admin?.name ?? selected.name;
    const province = admin?.province || selected.province || "";
    let parentName: string | null = null;
    if (atLevel === "emd" && admin?.code && admin.code.length >= 5) {
      parentName = sigunguByCode.get(admin.code.slice(0, 5))?.name ?? null;
    }
    return allHistoryEvents
      .filter((ev) =>
        eventMatchesSelection(ev, {
          level: atLevel,
          province,
          name,
          parentName,
        }),
      )
      .sort((a, b) => String(b.datetime).localeCompare(String(a.datetime)));
  }, [selected, selectedAdmin, allHistoryEvents, level, sigunguByCode]);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const onWheel = (e: WheelEvent) => {
      if (mapModeRef.current !== "choropleth") return;
      e.preventDefault();
      const svg = svgRef.current;
      if (!svg) return;
      const prev = viewRef.current;
      const factor = Math.exp(-e.deltaY * 0.0015);
      const nextScale = Math.min(
        MAX_SCALE,
        Math.max(MIN_SCALE, prev.scale * factor),
      );
      if (nextScale === prev.scale) return;
      if (nextScale <= MIN_SCALE + 0.001) {
        setView(INITIAL_VIEW);
        return;
      }
      const { x: ux, y: uy } = clientToSvg(svg, e.clientX, e.clientY);
      const k = nextScale / prev.scale;
      setView({
        scale: nextScale,
        tx: ux - (ux - prev.tx) * k,
        ty: uy - (uy - prev.ty) * k,
      });
    };
    stage.addEventListener("wheel", onWheel, { passive: false });
    return () => stage.removeEventListener("wheel", onWheel);
  }, []);

  const stepZoom = useCallback((direction: 1 | -1) => {
    if (mapModeRef.current === "satellite") {
      setSatView((v) => ({
        ...v,
        level: Math.max(1, Math.min(KAKAO_MAX_LEVEL, v.level - direction)),
      }));
      setSatSyncKey((k) => k + 1);
      return;
    }
    const svg = svgRef.current;
    const prev = viewRef.current;
    const factor = direction > 0 ? 1.35 : 1 / 1.35;
    const nextScale = Math.min(
      MAX_SCALE,
      Math.max(MIN_SCALE, prev.scale * factor),
    );
    if (nextScale === prev.scale) return;
    if (nextScale <= MIN_SCALE + 0.001) {
      setView(INITIAL_VIEW);
      return;
    }
    if (!svg) {
      setView({ ...prev, scale: nextScale });
      return;
    }
    const rect = svg.getBoundingClientRect();
    const { x: ux, y: uy } = clientToSvg(
      svg,
      rect.left + rect.width / 2,
      rect.top + rect.height / 2,
    );
    const k = nextScale / prev.scale;
    setView({
      scale: nextScale,
      tx: ux - (ux - prev.tx) * k,
      ty: uy - (uy - prev.ty) * k,
    });
  }, []);

  /** 화면 픽셀 이동량 → SVG viewBox 단위 */
  const screenDeltaToViewBox = useCallback((dx: number, dy: number) => {
    const svg = svgRef.current;
    if (!svg) return { dx: 0, dy: 0 };
    const ctm = svg.getScreenCTM();
    if (!ctm) return { dx: 0, dy: 0 };
    const inv = ctm.inverse();
    return {
      dx: inv.a * dx + inv.c * dy,
      dy: inv.b * dx + inv.d * dy,
    };
  }, []);

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      // 좌클릭/터치만 · 짧은 클릭은 path onClick 으로 전달
      if (e.button !== 0) return;
      // 캡처는 하지 않음 — 짧은 클릭이 path onClick 으로 전달돼야 함
      panRef.current = {
        pointerId: e.pointerId,
        startX: e.clientX,
        startY: e.clientY,
        originTx: viewRef.current.tx,
        originTy: viewRef.current.ty,
        moved: false,
      };
      suppressClickRef.current = false;
    },
    [],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      const pan = panRef.current;
      if (!pan || pan.pointerId !== e.pointerId) return;
      const dxScreen = e.clientX - pan.startX;
      const dyScreen = e.clientY - pan.startY;
      if (!pan.moved) {
        if (Math.hypot(dxScreen, dyScreen) < PAN_THRESHOLD_PX) {
          return;
        }
        // 실제로 끌기 시작할 때만 캡처 → 클릭과 충돌 방지
        pan.moved = true;
        suppressClickRef.current = true;
        setIsPanning(true);
        try {
          stageRef.current?.setPointerCapture(e.pointerId);
        } catch {
          /* ignore */
        }
      }
      const { dx, dy } = screenDeltaToViewBox(dxScreen, dyScreen);
      setView((v) => ({
        ...v,
        tx: pan.originTx + dx,
        ty: pan.originTy + dy,
      }));
    },
    [screenDeltaToViewBox],
  );

  const endPan = useCallback((e: React.PointerEvent) => {
    const pan = panRef.current;
    if (!pan || pan.pointerId !== e.pointerId) return;
    const didPan = pan.moved;
    panRef.current = null;
    setIsPanning(false);
    if (didPan) {
      try {
        stageRef.current?.releasePointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
      // 팬 직후 합성 click 이 지역 선택으로 가지 않도록
      suppressClickRef.current = true;
      window.setTimeout(() => {
        suppressClickRef.current = false;
      }, 0);
    } else {
      suppressClickRef.current = false;
    }
  }, []);

  const toStat = useCallback(
    (admin: AdminRegion, atLevel: AdminLevel = level): RegionStat => {
      const key = stripName(admin.name);
      const predictP = labelProb(admin, atLevel);
      const intensity = isPredictMode
        ? (predictP ?? 0)
        : admin.prob;
      const baseRisk = Math.round(intensity * 1000) / 10;
      const fill = fillOf(admin, atLevel);

      // 시도: map-data는 시군구 단위 → 같은 시도 산 목록을 합침
      // (제주특별자치도 → strip "제주" 가 제주시와 우연히 겹치는 문제도 여기서 방지)
      if (atLevel === "sido" && admin.province) {
        const parts = regionList.filter((r) => r.province === admin.province);
        const mountains = mergeMountainCatalogs(parts);
        return {
          code: admin.code,
          name: admin.name,
          province: admin.province,
          province_name: admin.province_name,
          fire_count: admin.fire_count,
          risk_score: baseRisk,
          risk_tier:
            intensity >= 0.55 ? "고위험" : intensity >= 0.25 ? "주의" : "낮음",
          large_fire_pct: 0,
          intensity,
          color: fill,
          center: [admin.x, admin.y],
          ...mountains,
        };
      }

      // 시군구: 시도+이름으로만 매칭 (어간만으로 타 시도 장흥군 등에 붙지 않음)
      let hit: RegionStat | null = null;
      if (atLevel === "sigungu") {
        hit =
          byName.get(`${admin.province}|${admin.name}`) ||
          byName.get(`${admin.province}|${key}`) ||
          null;
      }

      // 읍면동: 코드 앞 5자리 → 상위 시군구 (이름 충돌 없음)
      if (!hit && atLevel === "emd") {
        const parentAdmin = sigunguByCode.get(admin.code.slice(0, 5));
        if (parentAdmin) {
          const pk = stripName(parentAdmin.name);
          hit =
            byName.get(`${parentAdmin.province}|${parentAdmin.name}`) ||
            byName.get(`${parentAdmin.province}|${pk}`) ||
            null;
        }
      }

      if (hit) {
        return {
          ...hit,
          code: admin.code,
          name: admin.name,
          province: admin.province || hit.province,
          province_name: admin.province_name || hit.province_name,
          fire_count: admin.fire_count,
          risk_score: baseRisk,
        };
      }

      return {
        code: admin.code,
        name: admin.name,
        province: admin.province,
        province_name: admin.province_name,
        fire_count: admin.fire_count,
        risk_score: baseRisk,
        risk_tier:
          intensity >= 0.55 ? "고위험" : intensity >= 0.25 ? "주의" : "낮음",
        large_fire_pct: 0,
        intensity,
        color: fill,
        center: [admin.x, admin.y],
        mountain_count: 0,
        top_mountains: [],
        catalog_mountains: [],
      };
    },
    [
      byName,
      labelProb,
      fillOf,
      isPredictMode,
      level,
      regionList,
      sigunguByCode,
    ],
  );

  const clearMountainPin = useCallback(() => {
    setPinnedMountain(null);
    setSearchPanelMountain(null);
    setMountainLink(null);
  }, []);

  const clearFirePin = useCallback(() => {
    setPinnedFire(null);
  }, []);

  const zoomToMountainLink = useCallback(
    (link: MountainRegionLink) => {
      if (link.marker) {
        const targetScale =
          link.marker.precision === "geocode"
            ? 4.8
            : link.marker.precision === "emd"
              ? 4.2
              : 2.8;
        const [vbW0, vbH0] = layers.sido.viewBox;
        const next = viewFromCenterSvg(
          link.marker.x,
          link.marker.y,
          targetScale,
          vbW0,
          vbH0,
        );
        setView(next);
        const kakao = svgViewToKakao(next, vbW0, vbH0);
        setSatView(kakao);
        setSatSyncKey((k) => k + 1);
      } else {
        setView((v) =>
          v.scale < 2.2 ? { scale: 2.4, tx: v.tx, ty: v.ty } : v,
        );
      }
    },
    [layers.sido.viewBox],
  );

  const locateMountainOnMap = useCallback(
    (mountain: MountainInfo) => {
      const full =
        mountain.id && mapData.mountains?.[mountain.id]
          ? { ...mapData.mountains[mountain.id], ...mountain }
          : mountain;
      const link = linkMountainToRegions(
        full,
        regionList,
        layers.sigungu.regions,
        layers.emd.regions,
      );
      setPinnedMountain(full);
      setMountainLink(link);
      zoomToMountainLink(link);
      return { full, link };
    },
    [
      mapData.mountains,
      regionList,
      layers.sigungu.regions,
      layers.emd.regions,
      zoomToMountainLink,
    ],
  );

  const firePinLabel = (ev: FireEvent) => {
    const parts = (ev.region || "")
      .split(/\s*>\s*/)
      .map((s) => s.trim())
      .filter(Boolean);
    return (
      ev.town?.trim() ||
      ev.village?.trim() ||
      ev.city?.trim() ||
      parts[parts.length - 1] ||
      "산불 발생지"
    );
  };

  const onSelectFire = useCallback(
    (ev: FireEvent, opts?: { selectRegion?: boolean }) => {
      clearMountainPin();
      setMobileNavOpen(false);

      const mt = (ev.mountain_list || []).find(
        (m) =>
          (m.svg_x != null && m.svg_y != null) ||
          (m.lat != null && m.lon != null),
      );
      let x: number | null = null;
      let y: number | null = null;
      let zoomScale = 4.2;

      if (mt?.svg_x != null && mt.svg_y != null) {
        x = mt.svg_x;
        y = mt.svg_y;
        zoomScale = 4.8;
      } else if (
        mt?.lat != null &&
        mt.lon != null &&
        Number.isFinite(mt.lat) &&
        Number.isFinite(mt.lon)
      ) {
        const svg = wgs84ToSvg(mt.lat, mt.lon);
        x = svg[0];
        y = svg[1];
        zoomScale = 4.8;
      } else {
        const hit = findAdminForFireEvent(ev, {
          emd: layers.emd.regions,
          sigungu: layers.sigungu.regions,
          sido: layers.sido.regions,
          sigunguByCode,
        });
        if (hit) {
          const center =
            hit.level === "sido"
              ? hit.region.label
              : (visualCenterFromPath(hit.region.d, hit.region.code) ??
                hit.region.label);
          x = center[0];
          y = center[1];
          zoomScale = hit.level === "emd" ? 4.2 : hit.level === "sigungu" ? 3.2 : 2.4;
          if (opts?.selectRegion !== false) {
            setSelectedAdmin(hit.region);
            setSelected(toStat(hit.region, hit.level));
          }
        }
      }

      if (x == null || y == null) return;
      setPinnedFire({ x, y, label: firePinLabel(ev) });
      const [vbW0, vbH0] = layers.sido.viewBox;
      const next = viewFromCenterSvg(x, y, zoomScale, vbW0, vbH0);
      setView(next);
      setSatView(svgViewToKakao(next, vbW0, vbH0));
      setSatSyncKey((k) => k + 1);
    },
    [
      clearMountainPin,
      layers.emd.regions,
      layers.sigungu.regions,
      layers.sido.regions,
      layers.sido.viewBox,
      sigunguByCode,
      toStat,
    ],
  );

  const onRegionClick = useCallback(
    (admin: AdminRegion) => {
      if (suppressClickRef.current) return;
      clearMountainPin();
      clearFirePin();
      setSelectedAdmin(admin);
      setSelected(toStat(admin));
    },
    [toStat, clearMountainPin, clearFirePin],
  );

  const onRegionSearchSelect = useCallback(
    (admin: AdminRegion, atLevel: AdminLevel) => {
      clearMountainPin();
      clearFirePin();
      setMobileNavOpen(false);
      setSelectedAdmin(admin);
      setSelected(toStat(admin, atLevel));

      const targetScale = atLevel === "sido" ? 3.8 : 7.2;
      const [vbW0, vbH0] = layers.sido.viewBox;
      const center =
        atLevel === "sido"
          ? admin.label
          : (visualCenterFromPath(admin.d, admin.code) ?? admin.label);
      const next = viewFromCenterSvg(
        center[0],
        center[1],
        targetScale,
        vbW0,
        vbH0,
      );
      setView(next);
      setSatView(svgViewToKakao(next, vbW0, vbH0));
      setSatSyncKey((k) => k + 1);
    },
    [clearMountainPin, clearFirePin, toStat, layers.sido.viewBox],
  );

  /** 검색바: 마커 + 검색 결과 패널 + 당일 예측 */
  const onMountainSelect = useCallback(
    (mountain: MountainInfo) => {
      clearFirePin();
      const { full, link } = locateMountainOnMap(mountain);
      setSearchPanelMountain(full);
      setRiskMode("daily");
      void fetchKmaPredict(false);
      if (link.adminRegion) {
        setSelectedAdmin(link.adminRegion);
        setSelected(toStat(link.adminRegion));
      } else if (link.mapRegion) {
        setSelected(link.mapRegion);
        setSelectedAdmin(null);
      }
    },
    [locateMountainOnMap, toStat, fetchKmaPredict, clearFirePin],
  );

  /** 산도감 등: 지도 마커만 (지역 패널 유지) */
  const onLocateMountain = useCallback(
    (mountain: MountainInfo) => {
      clearFirePin();
      locateMountainOnMap(mountain);
    },
    [locateMountainOnMap, clearFirePin],
  );

  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") {
        setSelected(null);
        setSelectedAdmin(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // 지역·산 선택 시 우측 패널 자동 펼침
  useEffect(() => {
    if (selected || searchPanelMountain) setRightPanelOpen(true);
  }, [selected?.code, searchPanelMountain?.id]);

  // 우측 패널 접기/펼치기 후 위성 지도 컨테이너 리사이즈
  useEffect(() => {
    if (mapMode !== "satellite") return;
    const t = window.setTimeout(() => setSatSyncKey((k) => k + 1), 80);
    return () => window.clearTimeout(t);
  }, [rightPanelOpen, mapMode]);

  // 레벨 바뀌면 선택 유지(다른 단위로 넘어감)
  useEffect(() => {
    setHovered(null);
  }, [level]);

  const mountainRisk = useMemo(() => {
    const code = mountainLink?.adminRegion?.code;
    if (!code || !isPredictMode) {
      return { norm: null as number | null, raw: null as number | null };
    }
    const d = activeByCode.get(code);
    return { norm: d?.norm ?? null, raw: d?.raw ?? null };
  }, [mountainLink, isPredictMode, activeByCode]);

  const switchMapMode = useCallback(
    (next: MapDisplayMode) => {
      if (next === mapMode) return;
      const [w, h] = layers.sido.viewBox;
      if (next === "satellite") {
        const kakao = svgViewToKakao(viewRef.current, w, h);
        setSatView(kakao);
        setSatSyncKey((k) => k + 1);
      } else {
        setView(kakaoToSvgView(satView.center, satView.level, w, h));
      }
      setMapMode(next);
    },
    [mapMode, layers.sido.viewBox, satView],
  );

  const onSatViewChange = useCallback(
    (v: SatelliteViewState) => {
      const next = {
        center: clampToKorea(v.center),
        level: Math.min(KAKAO_MAX_LEVEL, Math.max(1, v.level)),
      };
      setSatView(next);
      const [w, h] = layers.sido.viewBox;
      setView(kakaoToSvgView(next.center, next.level, w, h));
    },
    [layers.sido.viewBox],
  );

  const satMountainPin = useMemo(() => {
    if (!pinnedMountain) return null;
    if (
      pinnedMountain.lat != null &&
      pinnedMountain.lon != null &&
      Number.isFinite(pinnedMountain.lat) &&
      Number.isFinite(pinnedMountain.lon)
    ) {
      return {
        lat: pinnedMountain.lat,
        lng: pinnedMountain.lon,
        name: pinnedMountain.name,
      };
    }
    if (mountainLink?.marker) {
      const ll = svgToWgs84(mountainLink.marker.x, mountainLink.marker.y);
      return { ...ll, name: pinnedMountain.name };
    }
    return null;
  }, [pinnedMountain, mountainLink]);

  const satFirePin = useMemo(() => {
    if (!pinnedFire) return null;
    const ll = svgToWgs84(pinnedFire.x, pinnedFire.y);
    return { ...ll, name: pinnedFire.label };
  }, [pinnedFire]);

  const satColorOf = useCallback(
    (r: AdminRegion) => fillOf(r, level),
    [fillOf, level],
  );

  const satPaletteKey = `${riskMode}:${daily?.predict_date ?? ""}:${scenario?.predict_date ?? ""}:${scenario?.scenario_summary ?? ""}:${level}:${blankPredictMap ? "blank" : "filled"}`;

  const probLabel =
    riskMode === "daily"
      ? `산불위험지수${daily?.predict_date ? ` (${daily.predict_date})` : ""}`
      : riskMode === "scenario"
        ? `시나리오 위험지수${scenario?.predict_date ? ` (${scenario.predict_date})` : ""}`
        : "과거 산불 발생 건수";

  const zoomLabel =
    mapMode === "satellite"
      ? `Lv.${satView.level}`
      : `${view.scale.toFixed(1)}×`;

  const handleSyncUpdated = useCallback((payload: { mapData: MapData; layers: { sido: AdminLayer; sigungu: AdminLayer; emd: AdminLayer } }) => {
    setMapData(payload.mapData);
    setLayers(payload.layers);
  }, []);
  const { syncing, syncLastAt, runSync } = useHistorySync(handleSyncUpdated);

  const recentFires = useMemo(() => {
    return [...allHistoryEvents]
      .sort((a, b) => (b.datetime ?? "").localeCompare(a.datetime ?? ""))
      .slice(0, 5);
  }, [allHistoryEvents]);

  const sidebarProps = {
    riskMode,
    predictLoading,
    mountainIndex: mapData.mountains,
    sidoRegions: layers.sido.regions,
    sigunguRegions: layers.sigungu.regions,
    recentFires,
    onSelectMountain: onMountainSelect,
    onSelectRegion: onRegionSearchSelect,
    onSelectFire,
    onGoHome: () => {
      setSelected(null);
      setSelectedAdmin(null);
      setHovered(null);
      clearMountainPin();
      clearFirePin();
      setView(INITIAL_VIEW);
      setMapMode("choropleth");
      setSatView(svgViewToKakao(INITIAL_VIEW));
      setSatSyncKey((k) => k + 1);
      setMobileNavOpen(false);
    },
    onRiskMode: (mode: RiskMode) => {
      if (mode === "daily") {
        setRiskMode("daily");
        void fetchKmaPredict(false);
      } else if (mode === "scenario") {
        setRiskMode("scenario");
        setPredictError(null);
      } else {
        setRiskMode("history");
      }
      setMobileNavOpen(false);
    },
  };

  const [vbW, vbH] = layers.sido.viewBox;
  const viewBox = `0 0 ${vbW} ${vbH}`;
  const strokeBase = Math.max(0.25, 0.7 / view.scale);
  const labelStroke = Math.max(0.28, 1.2 / view.scale);
  const labelStrokeProvince = Math.max(1.2, 5.5 / view.scale);
  /** 호버 시군구 뱃지 — 화면 기준 눈에 띄는 크기 */
  const emdLabelFs = Math.max(0.4, 18 / view.scale);
  const emdLabelStroke = Math.max(0.08, 1.2 / view.scale);

  return (
    <div className="relative flex h-dvh w-full overflow-hidden bg-[#f4f7f9]">
      <div className="hidden h-full md:block">
        <AppSidebar {...sidebarProps} />
      </div>

      {mobileNavOpen && (
        <div className="absolute inset-0 z-50 flex md:hidden">
          <AppSidebar
            {...sidebarProps}
            mobile
            onCloseMobile={() => setMobileNavOpen(false)}
          />
          <button
            type="button"
            className="min-w-0 flex-1 bg-black/30"
            aria-label="메뉴 닫기"
            onClick={() => setMobileNavOpen(false)}
          />
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <div className="flex shrink-0 items-center gap-3 border-b border-[#e5e7eb] bg-white px-4 py-2.5 md:hidden">
          <button
            type="button"
            onClick={() => setMobileNavOpen(true)}
            className="rounded-xl px-2.5 py-1.5 text-sm font-medium text-[#111827] ring-1 ring-[#e5e7eb]"
          >
            메뉴
          </button>
          <div className="min-w-0 flex-1">
            <button
              type="button"
              onClick={sidebarProps.onGoHome}
              className="block w-full text-left"
              aria-label="홈으로 돌아가기"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/logo-forestfire-atlas.png"
                alt="Forestfire Atlas Korea"
                className="h-7 w-auto max-w-[200px] object-contain object-left"
              />
            </button>
            <p className="mt-0.5 truncate text-[11px] text-[#6b7280]">
              {LEVEL_LABEL[level]} · {zoomLabel}
            </p>
          </div>
        </div>

        <section className="relative min-h-0 flex-1 overflow-hidden bg-[#e8eef3]">
          <div
            ref={stageRef}
            className={`map-stage absolute inset-0 ${
              mapMode === "choropleth"
                ? isPanning
                  ? "cursor-grabbing"
                  : "cursor-grab"
                : ""
            }`}
            onPointerDown={mapMode === "choropleth" ? onPointerDown : undefined}
            onPointerMove={mapMode === "choropleth" ? onPointerMove : undefined}
            onPointerUp={mapMode === "choropleth" ? endPan : undefined}
            onPointerCancel={mapMode === "choropleth" ? endPan : undefined}
          >
            {mapMode === "satellite" ? (
              <SatelliteMap
                regions={activeLayer.regions}
                outlineRegions={
                  level === "emd" ? layers.sigungu.regions : undefined
                }
                level={level}
                colorOf={satColorOf}
                paletteKey={satPaletteKey}
                selectedCode={selectedAdmin?.code ?? null}
                syncKey={satSyncKey}
                syncView={satView}
                mountainPin={satMountainPin}
                firePin={satFirePin}
                onRegionClick={onRegionClick}
                onRegionHover={setHovered}
                onViewChange={onSatViewChange}
                onMapClickEmpty={() => {
                  setSelected(null);
                  setSelectedAdmin(null);
                  clearFirePin();
                }}
              />
            ) : (
            <svg
              ref={svgRef}
              viewBox={viewBox}
              className="h-full w-full origin-center scale-[1.12] select-none"
              role="img"
              aria-label="행정구역 산불 위험 지도"
              preserveAspectRatio="xMidYMid meet"
            >
              <rect
                x={0}
                y={0}
                width={vbW}
                height={vbH}
                fill="transparent"
                onClick={() => {
                  if (suppressClickRef.current) return;
                  setSelected(null);
                  setSelectedAdmin(null);
                }}
              />

              <g transform={`translate(${view.tx} ${view.ty}) scale(${view.scale})`}>
                {activeLayer.regions.map((r) => {
                  const isSelected = selectedAdmin?.code === r.code;
                  const isHovered = hovered?.code === r.code;
                  const active = isSelected || isHovered;
                  const fill = fillOf(r, level);
                  const isEmd = level === "emd";
                  const dimOthers = !!selectedAdmin && !isSelected;
                  return (
                    <path
                      key={r.code}
                      d={r.d}
                      fill={fill}
                      fillOpacity={
                        blankPredictMap
                          ? 1
                          : isSelected
                            ? 1
                            : dimOthers
                              ? isHovered
                                ? SELECT_DIM.fillHover
                                : isEmd
                                  ? SELECT_DIM.fillEmd
                                  : SELECT_DIM.fill
                              : active
                                ? 0.98
                                : isEmd
                                  ? 0.9
                                  : 0.88
                      }
                      stroke={blankPredictMap ? "#c5cdd6" : "#fffefb"}
                      strokeWidth={
                        isEmd
                          ? Math.max(0.08, 1.15 / view.scale)
                          : level === "sigungu"
                            ? Math.max(0.1, 1.35 / view.scale)
                            : strokeBase
                      }
                      strokeOpacity={
                        dimOthers
                          ? isHovered
                            ? SELECT_DIM.strokeHover
                            : isEmd
                              ? SELECT_DIM.strokeEmd
                              : SELECT_DIM.stroke
                          : isEmd
                            ? 0.85
                            : 0.95
                      }
                      strokeLinejoin="round"
                      strokeLinecap="round"
                      className={
                        isPanning ? "cursor-grabbing" : "cursor-grab"
                      }
                      onMouseEnter={() => setHovered(r)}
                      onMouseLeave={() =>
                        setHovered((h) => (h?.code === r.code ? null : h))
                      }
                      onClick={(e) => {
                        e.stopPropagation();
                        onRegionClick(r);
                      }}
                    />
                  );
                })}

                {/* 읍면동 단계: 상위 시군구 흰 외곽선은 표시하지 않음 (줌 확대 시 경계만 유지) */}

                {/* 호버·선택 외곽: fill 위에 따로 그려 굵기·색 균일 유지 */}
                {(() => {
                  const isEmd = level === "emd";
                  const hlStroke = Math.max(
                    0.35,
                    (isEmd ? 2.4 : 2.8) / view.scale,
                  );
                  const seen = new Set<string>();
                  const list: AdminRegion[] = [];
                  for (const r of [selectedAdmin, hovered]) {
                    if (r && !seen.has(r.code)) {
                      seen.add(r.code);
                      list.push(r);
                    }
                  }
                  return list.map((r) => (
                    <path
                      key={`hl-${r.code}`}
                      d={r.d}
                      fill="none"
                      stroke="#1c1917"
                      strokeWidth={hlStroke}
                      strokeOpacity={1}
                      strokeLinejoin="round"
                      strokeLinecap="round"
                      className="pointer-events-none"
                    />
                  ));
                })()}

                {activeLayer.regions.map((r) => {
                  const isSelected = selectedAdmin?.code === r.code;
                  const isHovered = hovered?.code === r.code;
                  const active = isSelected || isHovered;
                  // 읍면동: 호버·선택만 / 시도·시군구: 전체 표시(면적 비례 폰트)
                  if (level === "emd" && !active) return null;
                  const dimLabel = !!selectedAdmin && !isSelected;
                  const provinceLabel =
                    level === "sido" && isProvinceSido(r.name);
                  const laid = labelLayout.get(r.code);
                  const emdCenter =
                    level === "emd"
                      ? (visualCenterFromPath(r.d, r.code) ?? r.label)
                      : null;
                  const lx = laid?.x ?? emdCenter?.[0] ?? r.label[0];
                  const ly = laid?.y ?? emdCenter?.[1] ?? r.label[1];
                  const layoutFs = laid?.fs;
                  const fs =
                    level === "emd"
                      ? emdLabelFs
                      : active
                        ? (layoutFs ?? 5.6) *
                          (provinceLabel ? 1.12 : 1.06)
                        : (layoutFs ?? 5.6);
                  return (
                    <text
                      key={`lb-${r.code}`}
                      x={lx}
                      y={ly}
                      textAnchor="middle"
                      dominantBaseline="middle"
                      fill={active ? "#0c0a09" : "#292524"}
                      fillOpacity={dimLabel ? SELECT_DIM.label : 1}
                      fontSize={fs}
                      fontWeight={
                        provinceLabel ? 700 : active ? 700 : 500
                      }
                      stroke="#F8FAFC"
                      strokeWidth={
                        level === "emd"
                          ? emdLabelStroke
                          : provinceLabel
                            ? labelStrokeProvince
                            : labelStroke
                      }
                      strokeOpacity={dimLabel ? SELECT_DIM.labelStroke : 1}
                      paintOrder="stroke"
                      strokeLinejoin="round"
                      className="pointer-events-none"
                      style={{
                        fontFamily: "var(--font-sans)",
                        letterSpacing: level === "sido" ? "0.02em" : "0",
                      }}
                    >
                      {shortLabel(r.name, level)}
                    </text>
                  );
                })}

                {/* 산 검색 마커 — 파란 핀 + 흰 글자/검정 테두리 이름 */}
                {pinnedMountain && mountainLink?.marker && (
                  <g
                    className="pointer-events-none"
                    transform={`translate(${mountainLink.marker.x} ${mountainLink.marker.y}) scale(${1 / view.scale})`}
                  >
                    {/* 팁이 (0,0) — 지도 좌표에 정확히 찍힘 */}
                    <path
                      d="M0 0c-1.1-8-15.5-22.5-15.5-34.5a15.5 15.5 0 1 1 31 0C15.5-22.5 1.1-8 0 0z"
                      fill="#3B5BDB"
                      stroke="#1e3a8a"
                      strokeWidth={1.2}
                      strokeLinejoin="round"
                    />
                    <circle cx={0} cy={-34.5} r={6.2} fill="#ffffff" />
                    <text
                      x={0}
                      y={-62}
                      textAnchor="middle"
                      fill="#ffffff"
                      fontSize={23}
                      fontWeight={700}
                      stroke="#1c1917"
                      strokeWidth={3.8}
                      paintOrder="stroke"
                      strokeLinejoin="round"
                      style={{ fontFamily: "var(--font-sans)" }}
                    >
                      {pinnedMountain.name}
                    </text>
                  </g>
                )}
                {pinnedFire && (
                  <g
                    className="pointer-events-none"
                    transform={`translate(${pinnedFire.x} ${pinnedFire.y}) scale(${1 / view.scale})`}
                  >
                    <path
                      d="M0 0c-1.1-8-15.5-22.5-15.5-34.5a15.5 15.5 0 1 1 31 0C15.5-22.5 1.1-8 0 0z"
                      fill="#e03131"
                      stroke="#9b1c1c"
                      strokeWidth={1.2}
                      strokeLinejoin="round"
                    />
                    <circle cx={0} cy={-34.5} r={6.2} fill="#ffffff" />
                    <path
                      d="M0 -31.1 L-3.2 -36.4 L3.2 -36.4 Z"
                      fill="#e03131"
                    />
                    <text
                      x={0}
                      y={-62}
                      textAnchor="middle"
                      fill="#ffffff"
                      fontSize={23}
                      fontWeight={700}
                      stroke="#1c1917"
                      strokeWidth={3.8}
                      paintOrder="stroke"
                      strokeLinejoin="round"
                      style={{ fontFamily: "var(--font-sans)" }}
                    >
                      {pinnedFire.label}
                    </text>
                  </g>
                )}
              </g>
            </svg>
            )}
          </div>

          {blankDailyMap && (predictLoading || predictError) && (
            <div className="pointer-events-none absolute inset-0 z-30 grid place-items-center px-6">
              <div className="max-w-sm rounded-2xl bg-white px-5 py-4 text-center shadow-[var(--shadow-card)] ring-1 ring-[#e5e7eb]">
                {predictLoading ? (
                  <p className="text-sm font-medium text-[#374151]">
                    당일 예측을 불러오는 중입니다…
                  </p>
                ) : (
                  <>
                    <p className="text-sm font-semibold text-[#111827]">
                      당일 예측에 실패했습니다
                    </p>
                    <p className="mt-1.5 text-[13px] leading-snug text-[#6b7280]">
                      기상청 관측을 불러오지 못했습니다. 강제 새로고침으로 다시
                      시도해 주세요.
                    </p>
                  </>
                )}
              </div>
            </div>
          )}

          <div className="pointer-events-none absolute top-4 right-4 left-4 z-40 flex items-start justify-between gap-3">
            <div className="pointer-events-none space-y-2">
              <div
                className="rounded-2xl bg-white/95 px-3.5 py-2 text-sm shadow-[var(--shadow-card)] ring-1 ring-[#e5e7eb]"
                title={
                  mapMode === "satellite"
                    ? `위성 · 줌 Lv.${satView.level}`
                    : `줌 ${view.scale.toFixed(1)}× · 스크롤 확대 · 드래그 이동`
                }
              >
                <p className="text-[11px] font-medium text-[#9ca3af]">
                  행정구역
                </p>
                <p className="text-[13px] font-semibold text-[#111827]">
                  {LEVEL_UNIT[level]}
                </p>
              </div>

              {(hovered || selectedAdmin) && !pinnedMountain && (
                <div className="max-w-xs rounded-2xl bg-white/95 px-3.5 py-2.5 text-sm text-[#111827] shadow-[var(--shadow-card)] ring-1 ring-[#e5e7eb]">
                  {(() => {
                    const m = hovered || selectedAdmin!;
                    const p = labelProb(m, level);
                    const modeLabel =
                      riskMode === "daily"
                        ? "당일예측 위험도"
                        : riskMode === "scenario"
                          ? "가상 위험도"
                          : null;
                    return (
                      <>
                        <p className="font-semibold">{m.name}</p>
                        <p className="text-[12px] text-[#6b7280]">
                          {parentSigungu
                            ? `${parentSigungu.name} · ${m.province_name || m.province}`
                            : m.province_name || m.province}
                        </p>
                        {riskMode === "scenario" ? (
                          p != null ? (
                            <p className="mt-1 text-sm">
                              <span className="block text-[11px] leading-snug text-[#6b7280]">
                                {modeLabel}
                              </span>
                              <span className="text-2xl font-bold text-[#e03131]">
                                {(p * 100).toFixed(1)}
                              </span>
                            </p>
                          ) : null
                        ) : (
                          <p className="mt-1 text-sm">
                            {isPredictMode && p != null ? (
                              <>
                                <span className="block text-[11px] leading-snug text-[#6b7280]">
                                  {modeLabel}
                                </span>
                                <span className="text-2xl font-bold text-[#e03131]">
                                  {(p * 100).toFixed(1)}
                                </span>
                                <span className="ml-2 text-xs text-[#6b7280]">
                                  과거 {m.fire_count.toLocaleString()}건
                                </span>
                              </>
                            ) : (
                              <>
                                <span className="block text-[11px] leading-snug text-[#6b7280]">
                                  과거 산불 발생
                                </span>
                                <span className="text-2xl font-bold text-[#e03131]">
                                  {m.fire_count.toLocaleString()}
                                </span>
                                <span className="ml-1 text-xs text-[#6b7280]">
                                  건
                                </span>
                              </>
                            )}
                          </p>
                        )}
                        {isPredictMode && activePredict?.predict_date && (
                          <p className="mt-0.5 text-[10px] text-[#9ca3af]">
                            예측일 {activePredict.predict_date}
                          </p>
                        )}
                        {predictError && isPredictMode && !blankPredictMap && (
                          <p className="mt-0.5 text-[10px] text-[#e03131]">
                            {predictError}
                          </p>
                        )}
                      </>
                    );
                  })()}
                </div>
              )}
            </div>

            <div className="pointer-events-auto flex shrink-0 flex-col items-end gap-2">
              <MapChrome
                mapMode={mapMode}
                onMapMode={switchMapMode}
                onLogin={() => setAuthModal("login")}
                onRegister={() => setAuthModal("register")}
              />
              {riskMode === "daily" && (
                <DailyPredictForm
                  daily={daily}
                  loading={predictLoading}
                  error={daily ? predictError : null}
                  selectedCode={selectedAdmin?.code ?? null}
                  selectedName={selectedAdmin?.name ?? null}
                  selectedLevel={level}
                  onRefresh={() => {
                    void fetchKmaPredict(true);
                  }}
                />
              )}
              {riskMode === "scenario" && (
                <ScenarioPredictForm
                  onPredicted={(data) => {
                    setScenario(data);
                    setPredictError(null);
                  }}
                />
              )}
            </div>
          </div>

          <div className="pointer-events-none absolute right-5 bottom-5 z-20">
            <div className="pointer-events-auto">
              <MapLegend
                mode={riskMode}
                auc={
                  isPredictMode
                    ? activePredict?.model_metrics?.roc_auc ??
                      mlScores?.metrics?.roc_auc
                    : undefined
                }
                predictDate={activePredict?.predict_date}
              />
            </div>
          </div>
        </section>
      </div>

      {/* 접힌 상태: 화면 오른쪽 가장자리 중앙 */}
      {!rightPanelOpen && (
        <button
          type="button"
          onClick={() => setRightPanelOpen(true)}
          className="absolute top-1/2 right-0 z-30 hidden h-12 w-7 -translate-y-1/2 items-center justify-center rounded-l-xl border border-r-0 border-[#e5e7eb] bg-white text-base text-[#4b5563] shadow-sm transition hover:bg-[#f9fafb] md:flex"
          aria-label="패널 열기"
          title="패널 열기"
        >
          ‹
        </button>
      )}

      {/* 데스크톱 우측 패널 */}
      {rightPanelOpen && (
        <div className="relative hidden h-full w-[min(400px,38vw)] shrink-0 md:block">
          <button
            type="button"
            onClick={() => setRightPanelOpen(false)}
            className="absolute top-1/2 left-0 z-30 flex h-12 w-7 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-xl border border-[#e5e7eb] bg-white text-base text-[#4b5563] shadow-sm transition hover:bg-[#f9fafb]"
            aria-label="패널 접기"
            title="패널 접기"
          >
            ›
          </button>
          {searchPanelMountain ? (
            <MountainSearchResult
              mountain={searchPanelMountain}
              mapRegion={mountainLink?.mapRegion}
              adminRegion={mountainLink?.adminRegion}
              mlRiskNorm={mountainRisk.norm}
              mlRiskRaw={mountainRisk.raw}
              riskMode={riskMode}
              predictDate={activePredict?.predict_date}
              predictLoading={predictLoading}
              predictError={predictError}
              onBack={() => {
                clearMountainPin();
              }}
              onFocusRegion={() => {
                if (mountainLink?.adminRegion) {
                  setSelectedAdmin(mountainLink.adminRegion);
                  setSelected(toStat(mountainLink.adminRegion));
                }
              }}
            />
          ) : (
            <FireHistoryPanel
              key={selected?.code ?? "none"}
              province={selected}
              events={eventsForSelection}
              mountainIndex={mapData.mountains}
              totalFires={mapData.meta.total_fires}
              totalMountains={mapData.meta.total_mountains}
              matchedFires={mapData.meta.matched_fires}
              probability={
                isPredictMode && selectedAdmin
                  ? (labelProb(selectedAdmin, level) ?? undefined)
                  : undefined
              }
              probabilityLabel={isPredictMode ? probLabel : undefined}
              predictRegions={isPredictMode ? activePredict?.regions : null}
              riskMode={riskMode}
              onLocateMountain={onLocateMountain}
              onSelectFire={(ev) => onSelectFire(ev, { selectRegion: false })}
              syncLastAt={syncLastAt}
              syncing={syncing}
              onSync={runSync}
              onClose={() => {
                setSelected(null);
                setSelectedAdmin(null);
                clearMountainPin();
              }}
            />
          )}
        </div>
      )}

      {searchPanelMountain && (
        <div className="absolute inset-y-0 right-0 z-40 w-full max-w-md md:hidden">
          <MountainSearchResult
            mountain={searchPanelMountain}
            mapRegion={mountainLink?.mapRegion}
            adminRegion={mountainLink?.adminRegion}
            mlRiskNorm={mountainRisk.norm}
            mlRiskRaw={mountainRisk.raw}
            riskMode={riskMode}
            predictDate={activePredict?.predict_date}
            predictLoading={predictLoading}
            predictError={predictError}
            onBack={() => {
              clearMountainPin();
            }}
            onFocusRegion={() => {
              if (mountainLink?.adminRegion) {
                setSelectedAdmin(mountainLink.adminRegion);
                setSelected(toStat(mountainLink.adminRegion));
              }
            }}
          />
        </div>
      )}

      {selected && !searchPanelMountain && (
        <div className="absolute inset-y-0 right-0 z-40 w-full max-w-md md:hidden">
          <FireHistoryPanel
            key={`m-${selected.code}`}
            province={selected}
            events={eventsForSelection}
            mountainIndex={mapData.mountains}
            totalFires={mapData.meta.total_fires}
            totalMountains={mapData.meta.total_mountains}
            matchedFires={mapData.meta.matched_fires}
            probability={
              isPredictMode && selectedAdmin
                ? (labelProb(selectedAdmin, level) ?? undefined)
                : undefined
            }
            probabilityLabel={isPredictMode ? probLabel : undefined}
            predictRegions={isPredictMode ? activePredict?.regions : null}
            riskMode={riskMode}
            onLocateMountain={onLocateMountain}
            onSelectFire={(ev) => onSelectFire(ev, { selectRegion: false })}
            syncLastAt={syncLastAt}
            syncing={syncing}
            onSync={runSync}
            onClose={() => {
              setSelected(null);
              setSelectedAdmin(null);
              clearMountainPin();
            }}
          />
        </div>
      )}

      <AuthModal
        open={authModal != null}
        mode={authModal ?? "login"}
        onClose={() => {
          clearOauthError();
          setAuthModal(null);
        }}
      />
    </div>
  );
}
