/** 카카오 지도 JS SDK 로더 (autoload=false) */

export type KakaoLatLng = {
  getLat(): number;
  getLng(): number;
};

export type KakaoMap = {
  setCenter(latlng: KakaoLatLng): void;
  getCenter(): KakaoLatLng;
  setLevel(level: number, options?: { animate?: boolean }): void;
  getLevel(): number;
  setMapTypeId(typeId: number | string): void;
  relayout(): void;
  setBounds(bounds: KakaoLatLngBounds, padding?: number): void;
};

export type KakaoLatLngBounds = {
  extend(latlng: KakaoLatLng): void;
};

export type KakaoPolygon = {
  setMap(map: KakaoMap | null): void;
  setOptions(options: Record<string, unknown>): void;
};

export type KakaoMarker = {
  setMap(map: KakaoMap | null): void;
  setPosition(latlng: KakaoLatLng): void;
};

export type KakaoMapsNamespace = {
  LatLng: new (lat: number, lng: number) => KakaoLatLng;
  LatLngBounds: new () => KakaoLatLngBounds;
  Map: new (
    container: HTMLElement,
    options: {
      center: KakaoLatLng;
      level: number;
      mapTypeId?: number | string;
    },
  ) => KakaoMap;
  Polygon: new (options: {
    map?: KakaoMap;
    path: KakaoLatLng[] | KakaoLatLng[][];
    strokeWeight?: number;
    strokeColor?: string;
    strokeOpacity?: number;
    strokeStyle?: string;
    fillColor?: string;
    fillOpacity?: number;
    zIndex?: number;
  }) => KakaoPolygon;
  Marker: new (options: {
    map?: KakaoMap;
    position: KakaoLatLng;
    title?: string;
    zIndex?: number;
  }) => KakaoMarker;
  CustomOverlay: new (options: {
    map?: KakaoMap | null;
    position: KakaoLatLng;
    content: string | HTMLElement;
    xAnchor?: number;
    yAnchor?: number;
    zIndex?: number;
  }) => {
    setMap(map: KakaoMap | null): void;
    setPosition(latlng: KakaoLatLng): void;
  };
  event: {
    addListener(
      target: object,
      type: string,
      handler: (...args: unknown[]) => void,
    ): void;
    removeListener(
      target: object,
      type: string,
      handler: (...args: unknown[]) => void,
    ): void;
  };
  MapTypeId: {
    ROADMAP: number | string;
    SKYVIEW: number | string;
    HYBRID: number | string;
  };
  load: (callback: () => void) => void;
};

declare global {
  interface Window {
    kakao?: { maps: KakaoMapsNamespace };
  }
}

let loadPromise: Promise<KakaoMapsNamespace> | null = null;

export function getKakaoMapKey(): string {
  return (process.env.NEXT_PUBLIC_KAKAO_MAP_KEY || "").trim();
}

export function loadKakaoMaps(): Promise<KakaoMapsNamespace> {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("window 없음"));
  }
  if (window.kakao?.maps?.Map) {
    return Promise.resolve(window.kakao.maps);
  }
  if (loadPromise) return loadPromise;

  const key = getKakaoMapKey();
  if (!key) {
    return Promise.reject(
      new Error(
        "NEXT_PUBLIC_KAKAO_MAP_KEY 가 없습니다. frontend/.env.local 에 설정하세요.",
      ),
    );
  }

  loadPromise = new Promise((resolve, reject) => {
    const finish = () => {
      const maps = window.kakao?.maps;
      if (!maps) {
        reject(new Error("카카오 지도 SDK 로드 실패"));
        return;
      }
      maps.load(() => {
        if (!window.kakao?.maps?.Map) {
          reject(new Error("카카오 지도 API 초기화 실패"));
          return;
        }
        resolve(window.kakao.maps);
      });
    };

    const existing = document.querySelector<HTMLScriptElement>(
      "script[data-kakao-maps]",
    );
    if (existing) {
      if (window.kakao?.maps) {
        finish();
      } else {
        existing.addEventListener("load", finish);
        existing.addEventListener("error", () =>
          reject(new Error("카카오 지도 스크립트 로드 오류")),
        );
      }
      return;
    }

    const script = document.createElement("script");
    script.async = true;
    script.dataset.kakaoMaps = "1";
    script.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${encodeURIComponent(key)}&autoload=false`;
    script.onload = finish;
    script.onerror = () => {
      loadPromise = null;
      reject(new Error("카카오 지도 스크립트 로드 오류"));
    };
    document.head.appendChild(script);
  });

  return loadPromise;
}
