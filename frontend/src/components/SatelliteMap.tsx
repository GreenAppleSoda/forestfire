"use client";

import type { AdminLevel, AdminRegion } from "@/lib/types";
import {
  getKakaoMapKey,
  loadKakaoMaps,
  type KakaoMap,
  type KakaoMapsNamespace,
  type KakaoMarker,
  type KakaoPolygon,
} from "@/lib/kakaoMaps";
import {
  svgPathToLatLngRings,
  svgToWgs84,
  type LatLng,
} from "@/lib/svgProjection";
import { useEffect, useMemo, useRef, useState } from "react";

export type SatelliteViewState = {
  center: LatLng;
  level: number;
};

type MountainPin = {
  lat: number;
  lng: number;
  name: string;
};

type Props = {
  regions: AdminRegion[];
  /** 읍면동일 때 시군구 외곽 */
  outlineRegions?: AdminRegion[];
  level: AdminLevel;
  colorOf: (r: AdminRegion) => string;
  /** 색상 팔레트가 바뀔 때 (위험 모드·예측 결과) */
  paletteKey: string;
  selectedCode: string | null;
  syncKey: number;
  syncView: SatelliteViewState;
  mountainPin?: MountainPin | null;
  onRegionClick: (r: AdminRegion) => void;
  onRegionHover: (r: AdminRegion | null) => void;
  onViewChange: (view: SatelliteViewState) => void;
  onMapClickEmpty?: () => void;
};

type PolyEntry = {
  region: AdminRegion;
  polygons: KakaoPolygon[];
};

function findFocusSigungu(
  sigungu: AdminRegion[],
  center: LatLng,
): AdminRegion | null {
  if (!sigungu.length) return null;
  let best: AdminRegion | null = null;
  let bestD = Infinity;
  for (const r of sigungu) {
    const p = svgToWgs84(r.x, r.y);
    const d =
      (p.lat - center.lat) * (p.lat - center.lat) +
      (p.lng - center.lng) * (p.lng - center.lng);
    if (d < bestD) {
      bestD = d;
      best = r;
    }
  }
  return best;
}

export function SatelliteMap({
  regions,
  outlineRegions = [],
  level,
  colorOf,
  paletteKey,
  selectedCode,
  syncKey,
  syncView,
  mountainPin,
  onRegionClick,
  onRegionHover,
  onViewChange,
  onMapClickEmpty,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<KakaoMap | null>(null);
  const mapsRef = useRef<KakaoMapsNamespace | null>(null);
  const polyRef = useRef<PolyEntry[]>([]);
  const outlineRef = useRef<KakaoPolygon[]>([]);
  const markerRef = useRef<KakaoMarker | null>(null);
  const overlayRef = useRef<{ setMap: (m: KakaoMap | null) => void } | null>(
    null,
  );
  const handlersRef = useRef({
    onRegionClick,
    onRegionHover,
    onViewChange,
    onMapClickEmpty,
    colorOf,
  });
  handlersRef.current = {
    onRegionClick,
    onRegionHover,
    onViewChange,
    onMapClickEmpty,
    colorOf,
  };

  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [focusCode, setFocusCode] = useState<string | null>(null);
  const syncViewRef = useRef(syncView);
  syncViewRef.current = syncView;
  const suppressIdleRef = useRef(false);
  /** 폴리곤 클릭 시 맵 click 도 같이 떠서 선택이 바로 풀리는 것 방지 */
  const suppressMapClickRef = useRef(false);
  const lastAppliedSyncKey = useRef<number | null>(null);

  const displayRegions = useMemo(() => {
    if (level !== "emd") return regions;
    // 선택 중이면 해당 시군구 읍면동을 고정 (주변 지역 하이라이트 유지)
    const focus =
      (selectedCode && selectedCode.length >= 5
        ? selectedCode.slice(0, 5)
        : null) || focusCode;
    if (!focus) return [];
    return regions.filter((r) => r.code.startsWith(focus));
  }, [level, regions, focusCode, selectedCode]);

  // 맵 생성
  useEffect(() => {
    let cancelled = false;
    const key = getKakaoMapKey();
    if (!key) {
      setError(
        "NEXT_PUBLIC_KAKAO_MAP_KEY 가 없습니다. frontend/.env.local 에 JavaScript 키를 넣어 주세요.",
      );
      return;
    }

    loadKakaoMaps()
      .then((maps) => {
        if (cancelled || !containerRef.current) return;
        mapsRef.current = maps;
        const { center, level: lv } = syncViewRef.current;
        const map = new maps.Map(containerRef.current, {
          center: new maps.LatLng(center.lat, center.lng),
          level: lv,
          mapTypeId: maps.MapTypeId.HYBRID,
        });
        mapRef.current = map;
        lastAppliedSyncKey.current = syncKey;
        setReady(true);

        const emitView = () => {
          if (suppressIdleRef.current) return;
          const c = map.getCenter();
          handlersRef.current.onViewChange({
            center: { lat: c.getLat(), lng: c.getLng() },
            level: map.getLevel(),
          });
        };

        maps.event.addListener(map, "idle", emitView);
        maps.event.addListener(map, "click", () => {
          // 폴리곤 click 과 동일 제스처에서 맵 click 이 연달아 옴 → 한 틱 뒤 확인
          window.setTimeout(() => {
            if (suppressMapClickRef.current) return;
            handlersRef.current.onMapClickEmpty?.();
          }, 0);
        });
      })
      .catch((e) => {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : String(e));
        }
      });

    return () => {
      cancelled = true;
      polyRef.current.forEach((e) =>
        e.polygons.forEach((p) => p.setMap(null)),
      );
      polyRef.current = [];
      outlineRef.current.forEach((p) => p.setMap(null));
      outlineRef.current = [];
      markerRef.current?.setMap(null);
      markerRef.current = null;
      overlayRef.current?.setMap(null);
      overlayRef.current = null;
      mapRef.current = null;
      setReady(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount once
  }, []);

  // 부모가 syncKey 를 올릴 때만 중심·줌 반영 (idle 피드백 루프 방지)
  useEffect(() => {
    const map = mapRef.current;
    const maps = mapsRef.current;
    if (!map || !maps || !ready) return;
    if (lastAppliedSyncKey.current === syncKey) return;
    lastAppliedSyncKey.current = syncKey;
    suppressIdleRef.current = true;
    map.setCenter(new maps.LatLng(syncView.center.lat, syncView.center.lng));
    map.setLevel(syncView.level);
    map.relayout();
    window.setTimeout(() => {
      suppressIdleRef.current = false;
    }, 150);
  }, [ready, syncKey, syncView]);

  // 읍면동 포커스 시군구 — 커서 위치 기준(호버 즉시), idle 시 중심도 보조
  useEffect(() => {
    if (!ready || level !== "emd") {
      setFocusCode(null);
      return;
    }
    const map = mapRef.current;
    const maps = mapsRef.current;
    if (!map || !maps) return;

    let raf = 0;
    let lastCode: string | null = null;
    let lastMoveAt = 0;

    const applyFocus = (lat: number, lng: number) => {
      const hit = findFocusSigungu(outlineRegions, { lat, lng });
      const next = hit?.code ?? null;
      if (next === lastCode) return;
      lastCode = next;
      setFocusCode(next);
    };

    const fromCenter = () => {
      const c = map.getCenter();
      applyFocus(c.getLat(), c.getLng());
    };

    const onMouseMove = (mouseEvent: { latLng: { getLat: () => number; getLng: () => number } }) => {
      const now = performance.now();
      if (now - lastMoveAt < 50) return;
      lastMoveAt = now;
      if (raf) cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const ll = mouseEvent.latLng;
        applyFocus(ll.getLat(), ll.getLng());
      });
    };

    fromCenter();
    maps.event.addListener(map, "mousemove", onMouseMove);
    maps.event.addListener(map, "idle", fromCenter);
    return () => {
      if (raf) cancelAnimationFrame(raf);
      maps.event.removeListener(map, "mousemove", onMouseMove);
      maps.event.removeListener(map, "idle", fromCenter);
    };
  }, [ready, level, outlineRegions]);

  // 코로플레스 폴리곤
  useEffect(() => {
    const map = mapRef.current;
    const maps = mapsRef.current;
    if (!map || !maps || !ready) return;

    polyRef.current.forEach((e) => e.polygons.forEach((p) => p.setMap(null)));
    polyRef.current = [];

    const entries: PolyEntry[] = [];
    for (const region of displayRegions) {
      if (!region.d) continue;
      const rings = svgPathToLatLngRings(region.d);
      const polygons: KakaoPolygon[] = [];
      const fill = handlersRef.current.colorOf(region);
      const selected = region.code === selectedCode;
      const baseOpacity = level === "emd" ? 0.55 : 0.58;

      for (const ring of rings) {
        if (ring.length < 3) continue;
        const path = ring.map((p) => new maps.LatLng(p.lat, p.lng));
        const polygon = new maps.Polygon({
          map,
          path,
          strokeWeight: selected ? 2.5 : level === "emd" ? 0.8 : 1.2,
          strokeColor: selected ? "#1c1917" : "#fffefb",
          strokeOpacity: selected ? 1 : 0.85,
          fillColor: fill,
          fillOpacity: selected ? 0.72 : baseOpacity,
          zIndex: selected ? 4 : 2,
        });
        maps.event.addListener(polygon, "click", () => {
          suppressMapClickRef.current = true;
          handlersRef.current.onRegionClick(region);
          window.setTimeout(() => {
            suppressMapClickRef.current = false;
          }, 50);
        });
        maps.event.addListener(polygon, "mouseover", () => {
          handlersRef.current.onRegionHover(region);
          polygon.setOptions({
            fillOpacity: 0.82,
            strokeWeight: 2.2,
            strokeColor: "#1c1917",
            zIndex: 5,
          });
        });
        maps.event.addListener(polygon, "mouseout", () => {
          handlersRef.current.onRegionHover(null);
          const isSel = region.code === selectedCode;
          polygon.setOptions({
            fillOpacity: isSel ? 0.72 : baseOpacity,
            strokeWeight: isSel ? 2.5 : level === "emd" ? 0.8 : 1.2,
            strokeColor: isSel ? "#1c1917" : "#fffefb",
            zIndex: isSel ? 4 : 2,
          });
        });
        polygons.push(polygon);
      }
      if (polygons.length) entries.push({ region, polygons });
    }
    polyRef.current = entries;
  }, [ready, displayRegions, level, selectedCode, paletteKey]);

  // 시군구 외곽 (읍면동) — 생성은 레이어 변경 시만
  useEffect(() => {
    const map = mapRef.current;
    const maps = mapsRef.current;
    if (!map || !maps || !ready) return;

    outlineRef.current.forEach((p) => p.setMap(null));
    outlineRef.current = [];
    if (level !== "emd" || !outlineRegions.length) return;

    const polys: KakaoPolygon[] = [];
    for (const region of outlineRegions) {
      if (!region.d) continue;
      const rings = svgPathToLatLngRings(region.d);
      for (const ring of rings) {
        if (ring.length < 3) continue;
        const path = ring.map((p) => new maps.LatLng(p.lat, p.lng));
        const polygon = new maps.Polygon({
          map,
          path,
          strokeWeight: 1.2,
          strokeColor: "#1e3a5f",
          strokeOpacity: 0.95,
          fillColor: "#000000",
          fillOpacity: 0.01,
          zIndex: 3,
        });
        (polygon as KakaoPolygon & { __sigunguCode?: string }).__sigunguCode =
          region.code;
        maps.event.addListener(polygon, "mouseover", () => {
          setFocusCode(region.code);
        });
        polys.push(polygon);
      }
    }
    outlineRef.current = polys;
  }, [ready, level, outlineRegions]);

  // 시군구 외곽 강조 스타일만 갱신
  useEffect(() => {
    if (level !== "emd") return;
    for (const polygon of outlineRef.current) {
      const code = (polygon as KakaoPolygon & { __sigunguCode?: string })
        .__sigunguCode;
      if (!code) continue;
      const isParent =
        focusCode === code ||
        (selectedCode != null && selectedCode.startsWith(code));
      polygon.setOptions({
        strokeWeight: isParent ? 2.2 : 1.2,
        strokeColor: isParent ? "#0f2744" : "#1e3a5f",
        zIndex: isParent ? 1 : 3,
      });
    }
  }, [level, focusCode, selectedCode]);

  // 산 마커
  useEffect(() => {
    const map = mapRef.current;
    const maps = mapsRef.current;
    if (!map || !maps || !ready) return;

    markerRef.current?.setMap(null);
    markerRef.current = null;
    overlayRef.current?.setMap(null);
    overlayRef.current = null;

    if (!mountainPin) return;
    const pos = new maps.LatLng(mountainPin.lat, mountainPin.lng);
    markerRef.current = new maps.Marker({
      map,
      position: pos,
      title: mountainPin.name,
      zIndex: 10,
    });
    const el = document.createElement("div");
    el.style.cssText =
      "padding:4px 8px;border-radius:6px;background:rgba(28,25,23,.92);color:#fff;font-size:12px;font-weight:600;white-space:nowrap;box-shadow:0 2px 8px rgba(0,0,0,.25)";
    el.textContent = mountainPin.name;
    overlayRef.current = new maps.CustomOverlay({
      map,
      position: pos,
      content: el,
      yAnchor: 2.2,
      zIndex: 11,
    });
  }, [ready, mountainPin]);

  if (error) {
    return (
      <div className="absolute inset-0 flex items-center justify-center bg-[#1a2332] px-6">
        <div className="max-w-md rounded-lg border border-[#3f4b5c] bg-[#243044] px-4 py-3 text-sm text-[#e7ecf3]">
          <p className="font-medium">위성 지도를 불러올 수 없습니다</p>
          <p className="mt-1 text-[13px] text-[#a8b3c4]">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="absolute inset-0">
      <div ref={containerRef} className="h-full w-full" />
      {!ready && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-[#1a2332]/80">
          <p className="text-sm text-[#e7ecf3]">위성 지도 로딩 중…</p>
        </div>
      )}
    </div>
  );
}
