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
  kakaoToSvgView,
  svgToWgs84,
  svgViewToKakao,
  viewFromCenterSvg,
} from "@/lib/svgProjection";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DailyPredictForm } from "./DailyPredictForm";
import { ScenarioPredictForm } from "./ScenarioPredictForm";
import { FireHistoryPanel } from "./FireHistoryPanel";
import { HistorySyncControl } from "./HistorySyncControl";
import { MapLegend } from "./MapLegend";
import { AppSidebar } from "./AppSidebar";
import { MountainSearchResult } from "./MountainSearchResult";
import { SatelliteMap, type SatelliteViewState } from "./SatelliteMap";
import {
  linkMountainToRegions,
  type MountainRegionLink,
} from "@/lib/mountainSearch";

type Props = {
  mapData: MapData;
  layers: {
    sido: AdminLayer;
    sigungu: AdminLayer;
    emd: AdminLayer;
  };
  mlScores?: SigunguMlScores | null;
  dailyRisk?: DailyMlRisk | null;
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

const LEVEL_LABEL: Record<string, string> = {
  sido: "시도",
  sigungu: "시군구",
  emd: "읍면동",
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
  return name
    .replace(/\s+/g, "")
    .replace(/(특별자치시|광역시|특별시|특별자치도)$/g, "")
    .replace(/(시|군|구|읍|면|동|리)$/g, "");
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
  if (name.length > 6) return name.replace(/(시|군|구|읍|면|동)$/, "");
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

/** SVG path d 에서 대략적 bbox (숫자 좌표만) */
function pathBBox(d: string): {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
} | null {
  const nums = d.match(/-?\d*\.?\d+/g);
  if (!nums || nums.length < 4) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i + 1 < nums.length; i += 2) {
    const x = Number(nums[i]);
    const y = Number(nums[i + 1]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  if (!Number.isFinite(minX)) return null;
  return { minX, minY, maxX, maxY };
}

export function KoreaSvgMap({
  mapData: mapDataProp,
  layers: layersProp,
  mlScores,
  dailyRisk,
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
  const [daily, setDaily] = useState<DailyMlRisk | null>(dailyRisk ?? null);
  const [scenario, setScenario] = useState<DailyMlRisk | null>(null);
  const [predictLoading, setPredictLoading] = useState(false);
  const [predictError, setPredictError] = useState<string | null>(null);
  /** 지도 마커용 (검색·산도감 공통) */
  const [pinnedMountain, setPinnedMountain] = useState<MountainInfo | null>(
    null,
  );
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
        return data;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setPredictError(msg);
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
    if (riskMode === "daily" && !daily && !predictLoading) {
      void fetchKmaPredict(false);
    }
  }, [riskMode, daily, predictLoading, fetchKmaPredict]);

  const level = levelForScale(view.scale);
  const activeLayer =
    level === "sido"
      ? layers.sido
      : level === "sigungu"
        ? layers.sigungu
        : layers.emd;

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
      const v = colorProb(r, lvl);
      return isPredictMode ? probToColor(v) : intensityToColor(v);
    },
    [colorProb, isPredictMode, level],
  );

  const parentSigungu = useMemo(() => {
    const code = hovered?.code ?? selectedAdmin?.code;
    if (!code || level !== "emd" || code.length < 5) return null;
    return sigunguByCode.get(code.slice(0, 5)) ?? null;
  }, [hovered, selectedAdmin, level, sigunguByCode]);

  /** 읍면동 호버 중일 때만 테두리 바깥 시군구 뱃지 */
  const hoverSigunguBadge = useMemo(() => {
    if (level !== "emd" || !hovered || hovered.code.length < 5) return null;
    const sg = sigunguByCode.get(hovered.code.slice(0, 5));
    if (!sg?.d) return null;
    const box = pathBBox(sg.d);
    if (!box) return null;
    return { region: sg, box };
  }, [level, hovered, sigunguByCode]);

  const regionList = mapData.regions?.length
    ? mapData.regions
    : mapData.provinces;

  const byName = useMemo(() => {
    const m = new Map<string, RegionStat>();
    for (const r of regionList) {
      m.set(stripName(r.name), r);
      if (r.province) m.set(`${r.province}|${stripName(r.name)}`, r);
    }
    return m;
  }, [regionList]);

  const eventsForSelection = useMemo(() => {
    if (!selected) return [] as FireEvent[];
    const direct = mapData.history[selected.code];
    if (direct?.length) return direct;

    // 시도/읍면동: 이름·시도로 시군구 이력 합치기
    const key = stripName(selected.name);
    const prov = selected.province;
    const merged: FireEvent[] = [];
    const seen = new Set<string>();
    for (const r of regionList) {
      const matchProv = !prov || r.province === prov;
      const matchName =
        stripName(r.name) === key ||
        (prov && stripName(r.name).includes(key)) ||
        (level === "sido" && r.province === prov);
      if (!matchProv) continue;
      if (level === "sido") {
        if (r.province !== prov) continue;
      } else if (level === "emd") {
        // town name soft match via history region string
      } else if (!matchName && stripName(r.name) !== key) {
        continue;
      }
      for (const ev of mapData.history[r.code] ?? []) {
        const id = `${ev.datetime}|${ev.region}|${ev.damage_area}`;
        if (seen.has(id)) continue;
        seen.add(id);
        if (level === "emd") {
          const town = stripName(ev.town || "");
          if (town && town !== key && !ev.region.includes(selected.name.replace(/(읍|면|동)$/, ""))) {
            continue;
          }
        }
        merged.push(ev);
      }
    }
    return merged
      .sort((a, b) => String(b.datetime).localeCompare(String(a.datetime)))
      .slice(0, 30);
  }, [selected, mapData.history, regionList, level]);

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
        level: Math.max(1, Math.min(14, v.level - direction)),
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
      // 좌클릭/터치만 · 확대된 상태에서만 팬 준비
      if (e.button !== 0) return;
      if (viewRef.current.scale <= MIN_SCALE + 0.001) return;
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
    (admin: AdminRegion): RegionStat => {
      const key = stripName(admin.name);
      const predictP = labelProb(admin, level);
      const intensity = isPredictMode
        ? (predictP ?? 0)
        : admin.prob;
      const baseRisk = Math.round(intensity * 1000) / 10;
      const fill = fillOf(admin, level);

      // 시도: map-data는 시군구 단위 → 같은 시도 산 목록을 합침
      // (제주특별자치도 → strip "제주" 가 제주시와 우연히 겹치는 문제도 여기서 방지)
      if (level === "sido" && admin.province) {
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

      // 시군구 직접 매칭
      let hit =
        byName.get(`${admin.province}|${key}`) || byName.get(key) || null;

      // 읍면동: admin 시군구(코드 앞 5자리) → map-data 시군구 산도감
      if (!hit && level === "emd") {
        const parentAdmin = sigunguByCode.get(admin.code.slice(0, 5));
        if (parentAdmin) {
          const pk = stripName(parentAdmin.name);
          hit =
            byName.get(`${parentAdmin.province}|${pk}`) ||
            byName.get(pk) ||
            null;
        }
        if (!hit) {
          hit =
            regionList.find((r) => r.code === admin.code.slice(0, 5)) || null;
        }
      }

      if (hit) {
        return {
          ...hit,
          name: admin.name,
          province: admin.province || hit.province,
          province_name: admin.province_name || hit.province_name,
          fire_count: admin.fire_count || hit.fire_count,
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

  const onRegionClick = useCallback(
    (admin: AdminRegion) => {
      if (suppressClickRef.current) return;
      clearMountainPin();
      setSelectedAdmin(admin);
      setSelected(toStat(admin));
    },
    [toStat, clearMountainPin],
  );

  /** 검색바: 마커 + 검색 결과 패널 + 당일 예측 */
  const onMountainSelect = useCallback(
    (mountain: MountainInfo) => {
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
    [locateMountainOnMap, toStat, fetchKmaPredict],
  );

  /** 산도감 등: 지도 마커만 (지역 패널 유지) */
  const onLocateMountain = useCallback(
    (mountain: MountainInfo) => {
      locateMountainOnMap(mountain);
    },
    [locateMountainOnMap],
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
      setSatView(v);
      const [w, h] = layers.sido.viewBox;
      setView(kakaoToSvgView(v.center, v.level, w, h));
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

  const satColorOf = useCallback(
    (r: AdminRegion) => fillOf(r, level),
    [fillOf, level],
  );

  const satPaletteKey = `${riskMode}:${daily?.predict_date ?? ""}:${scenario?.predict_date ?? ""}:${level}`;

  const probLabel =
    riskMode === "daily"
      ? `당일 예측${daily?.predict_date ? ` (${daily.predict_date})` : ""}`
      : riskMode === "scenario"
        ? `사용자 지정${scenario?.predict_date ? ` (${scenario.predict_date})` : ""}`
        : "과거 산불 발생 건수";

  const overlayRisk =
    isPredictMode && (hovered || selectedAdmin)
      ? labelProb((hovered || selectedAdmin)!, level)
      : isPredictMode && activePredict?.regions?.length
        ? (() => {
            const vals = activePredict.regions
              .map((r) => r.ml_risk)
              .filter((v) => typeof v === "number" && !Number.isNaN(v));
            if (!vals.length) return null;
            return vals.reduce((a, b) => a + b, 0) / vals.length;
          })()
        : null;

  const zoomLabel =
    mapMode === "satellite"
      ? `Lv.${satView.level}`
      : `${view.scale.toFixed(1)}×`;

  const sidebarSync = (
    <HistorySyncControl
      onUpdated={({ mapData: nextMap, layers: nextLayers }) => {
        setMapData(nextMap);
        setLayers(nextLayers);
      }}
    />
  );

  const sidebarProps = {
    mapMode,
    riskMode,
    zoomLabel,
    predictLoading,
    mountainIndex: mapData.mountains,
    syncSlot: sidebarSync,
    onSelectMountain: onMountainSelect,
    onGoHome: () => {
      setSelected(null);
      setSelectedAdmin(null);
      setHovered(null);
      clearMountainPin();
      setView(INITIAL_VIEW);
      setMapMode("choropleth");
      setSatView(svgViewToKakao(INITIAL_VIEW));
      setSatSyncKey((k) => k + 1);
      setMobileNavOpen(false);
    },
    onMapMode: (mode: MapDisplayMode) => {
      switchMapMode(mode);
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
    onZoomIn: () => stepZoom(1),
    onZoomOut: () => stepZoom(-1),
  };

  const [vbW, vbH] = layers.sido.viewBox;
  const viewBox = `0 0 ${vbW} ${vbH}`;
  const strokeBase = Math.max(0.25, 0.7 / view.scale);
  const emdStroke = Math.max(0.15, 0.45 / view.scale);
  /** 읍면동 확대 시 시군구 외곽 — 짙은 남색, 얇은 선 */
  const sigunguOutline = Math.max(0.22, 1.05 / view.scale);
  const sigunguOutlineActive = Math.max(0.3, 1.35 / view.scale);
  const SIGUNGU_OUTLINE = "#ffffff";
  const SIGUNGU_OUTLINE_ACTIVE = "#ffffff";
  // 시도·시군구: 기존 방식 / 고배율에서는 화면상 글자 크기 유지(÷scale)
  // 시도 중 도 단위는 시(광역시·특별시)보다 크게
  const labelSizeCity =
    level === "sido"
      ? Math.max(7.5, 10.5 / Math.sqrt(view.scale))
      : Math.max(5.2, 7.2 / Math.sqrt(view.scale));
  const labelSizeProvince = labelSizeCity * 1.8;
  const labelStroke = Math.max(0.28, 1.2 / view.scale);
  const labelStrokeProvince = Math.max(1.2, 5.5 / view.scale);
  /** 호버 시군구 뱃지 — 화면 기준 눈에 띄는 크기 */
  const sigunguBadgeFs = Math.max(0.45, 18 / view.scale);
  const sigunguBadgePadX = Math.max(0.35, 7 / view.scale);
  const sigunguBadgePadY = Math.max(0.22, 4.2 / view.scale);
  const sigunguBadgeGap = Math.max(0.35, 6 / view.scale);
  /** 호버 읍면동 이름 */
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
              mapMode === "choropleth" && view.scale > MIN_SCALE + 0.001
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
                onRegionClick={onRegionClick}
                onRegionHover={setHovered}
                onViewChange={onSatViewChange}
                onMapClickEmpty={() => {
                  setSelected(null);
                  setSelectedAdmin(null);
                }}
              />
            ) : (
            <svg
              ref={svgRef}
              viewBox={viewBox}
              className="h-full w-full select-none"
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
                        isSelected
                          ? 0.98
                          : dimOthers
                            ? isHovered
                              ? SELECT_DIM.fillHover
                              : isEmd
                                ? SELECT_DIM.fillEmd
                                : SELECT_DIM.fill
                            : active
                              ? 0.95
                              : isEmd
                                ? 0.88
                                : 0.82
                      }
                      stroke="#fffefb"
                      strokeWidth={isEmd ? emdStroke : strokeBase}
                      strokeOpacity={
                        dimOthers
                          ? isHovered
                            ? SELECT_DIM.strokeHover
                            : isEmd
                              ? SELECT_DIM.strokeEmd
                              : SELECT_DIM.stroke
                          : isEmd
                            ? 0.55
                            : 1
                      }
                      className={
                        isPanning
                          ? "cursor-grabbing"
                          : view.scale > MIN_SCALE + 0.001
                            ? "cursor-grab"
                            : "cursor-pointer"
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

                {/* 읍면동 단계: 시군구 외곽 경계 */}
                {level === "emd" &&
                  layers.sigungu.regions.map((r) => {
                    const isParent = parentSigungu?.code === r.code;
                    return (
                      <path
                        key={`sg-outline-${r.code}`}
                        d={r.d}
                        fill="none"
                        stroke={isParent ? SIGUNGU_OUTLINE_ACTIVE : SIGUNGU_OUTLINE}
                        strokeWidth={
                          isParent ? sigunguOutlineActive : sigunguOutline
                        }
                        strokeOpacity={isParent ? 0.9 : 0.55}
                        className="pointer-events-none"
                      />
                    );
                  })}

                {/* 선택·호버 읍면동 fill 을 시군구 흰 선 위에 다시 그려 최상단 유지 */}
                {level === "emd" &&
                  (() => {
                    const seen = new Set<string>();
                    const list: AdminRegion[] = [];
                    for (const r of [selectedAdmin, hovered]) {
                      if (r?.d && !seen.has(r.code)) {
                        seen.add(r.code);
                        list.push(r);
                      }
                    }
                    return list.map((r) => {
                      const isSelected = selectedAdmin?.code === r.code;
                      return (
                        <path
                          key={`top-fill-${r.code}`}
                          d={r.d}
                          fill={fillOf(r, level)}
                          fillOpacity={isSelected ? 0.98 : 0.95}
                          stroke="none"
                          className="pointer-events-none"
                        />
                      );
                    });
                  })()}

                {/* 호버·선택 외곽: fill/시군구선 위에 따로 그려 굵기·색 균일 유지 */}
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

                {/* 읍면동 호버 중: 해당 시군구 이름 — 테두리 우상단 바깥 뱃지 */}
                {hoverSigunguBadge && (() => {
                  const { region: sg, box } = hoverSigunguBadge;
                  const label = shortLabel(sg.name, "sigungu");
                  // 대략 글자 폭 (한글 기준)
                  const tw = label.length * sigunguBadgeFs * 0.95;
                  const th = sigunguBadgeFs * 1.15;
                  const bx =
                    box.maxX - tw - sigunguBadgePadX * 2;
                  const by = box.minY - th - sigunguBadgePadY * 2 - sigunguBadgeGap;
                  const tx = bx + sigunguBadgePadX;
                  const ty = by + sigunguBadgePadY + sigunguBadgeFs * 0.85;
                  return (
                    <g key={`sg-badge-${sg.code}`} className="pointer-events-none">
                      <rect
                        x={bx}
                        y={by}
                        width={tw + sigunguBadgePadX * 2}
                        height={th + sigunguBadgePadY * 2}
                        rx={Math.max(0.15, 2.5 / view.scale)}
                        fill="#1c1917"
                        fillOpacity={0.92}
                        stroke="#fffefb"
                        strokeWidth={Math.max(0.08, 1.4 / view.scale)}
                      />
                      <text
                        x={tx}
                        y={ty}
                        textAnchor="start"
                        fill="#fffefb"
                        fontSize={sigunguBadgeFs}
                        fontWeight={700}
                        style={{ fontFamily: "var(--font-sans)" }}
                      >
                        {label}
                      </text>
                    </g>
                  );
                })()}

                {activeLayer.regions.map((r) => {
                  const isSelected = selectedAdmin?.code === r.code;
                  const active =
                    isSelected || hovered?.code === r.code;
                  // 시도·시군구: 전체 라벨 / 읍면동: 호버·선택만
                  if (level === "emd" && !active) return null;
                  const dimLabel = !!selectedAdmin && !isSelected;
                  const provinceLabel =
                    level === "sido" && isProvinceSido(r.name);
                  const baseFs = provinceLabel
                    ? labelSizeProvince
                    : labelSizeCity;
                  const fs =
                    level === "emd"
                      ? emdLabelFs
                      : active
                        ? baseFs + (provinceLabel ? 2 : 0.8)
                        : baseFs;
                  return (
                    <text
                      key={`lb-${r.code}`}
                      x={r.label[0]}
                      y={r.label[1]}
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
              </g>
            </svg>
            )}
          </div>

          <div className="pointer-events-none absolute top-4 right-4 left-4 z-20 flex items-start justify-between gap-3">
            <div className="pointer-events-none space-y-2">
              <div className="rounded-2xl bg-white/95 px-3.5 py-2.5 text-sm shadow-[var(--shadow-card)] ring-1 ring-[#e5e7eb]">
                <p className="text-[11px] font-semibold tracking-[0.08em] text-[#9ca3af] uppercase">
                  행정 단위
                </p>
                <p className="font-semibold text-[#111827]">
                  {LEVEL_LABEL[level]}
                  <span className="ml-2 text-xs font-normal text-[#6b7280]">
                    {mapMode === "satellite"
                      ? `위성 · 줌 Lv.${satView.level}${level === "emd" ? " · 커서 위치 시군구 읍면동" : ""}`
                      : `줌 ${view.scale.toFixed(1)}× · 스크롤 확대 · 드래그 이동`}
                  </span>
                </p>
              </div>

              {(hovered || selectedAdmin) && !pinnedMountain && (
                <div className="max-w-xs rounded-2xl bg-white/95 px-3.5 py-2.5 text-sm text-[#111827] shadow-[var(--shadow-card)] ring-1 ring-[#e5e7eb]">
                  {(() => {
                    const m = hovered || selectedAdmin!;
                    const p = labelProb(m, level);
                    const modeLabel =
                      riskMode === "daily"
                        ? "당일 예측 "
                        : riskMode === "scenario"
                          ? "시나리오 "
                          : null;
                    return (
                      <>
                        <p className="font-semibold">{m.name}</p>
                        <p className="text-[12px] text-[#6b7280]">
                          {parentSigungu
                            ? `${parentSigungu.name} · ${m.province_name || m.province}`
                            : m.province_name || m.province}
                        </p>
                        <p className="mt-1 text-sm">
                          {isPredictMode && p != null ? (
                            <>
                              <span className="block text-[11px] leading-snug text-[#6b7280]">
                                {modeLabel}
                              </span>
                              <span className="text-2xl font-bold text-[#e03131]">
                                {(p * 100).toFixed(1)}%
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
                        {isPredictMode && activePredict?.predict_date && (
                          <p className="mt-0.5 text-[10px] text-[#9ca3af]">
                            예측일 {activePredict.predict_date}
                            {activePredict.weather_source
                              ? ` · ${activePredict.weather_source}`
                              : riskMode === "daily"
                                ? " · 기상청 ASOS"
                                : ""}
                          </p>
                        )}
                        {predictError && isPredictMode && (
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
              {riskMode === "daily" && (
                <DailyPredictForm
                  daily={daily}
                  selectedCode={selectedAdmin?.code ?? null}
                  selectedName={selectedAdmin?.name ?? null}
                  selectedLevel={level}
                  onPredicted={(data) => {
                    setDaily(data);
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

          <div className="pointer-events-none absolute bottom-5 left-5 z-20">
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
                riskValue={overlayRisk}
                riskTitle={
                  hovered || selectedAdmin
                    ? `${(hovered || selectedAdmin)!.name} 위험`
                    : undefined
                }
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
              weatherSource={activePredict?.weather_source}
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
              onLocateMountain={onLocateMountain}
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
            weatherSource={activePredict?.weather_source}
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
            onLocateMountain={onLocateMountain}
            onClose={() => {
              setSelected(null);
              setSelectedAdmin(null);
              clearMountainPin();
            }}
          />
        </div>
      )}
    </div>
  );
}
