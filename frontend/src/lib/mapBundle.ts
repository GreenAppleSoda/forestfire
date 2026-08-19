import type { AdminLayer, MapData } from "@/lib/types";
import { readApiJson } from "@/lib/apiJson";

export function isUsableMapData(
  data: MapData | null | undefined,
): data is MapData {
  return Array.isArray(data?.regions) || Array.isArray(data?.provinces);
}

export function isUsableLayer(
  layer: AdminLayer | null | undefined,
): layer is AdminLayer {
  return Array.isArray(layer?.regions);
}

function isAbortError(e: unknown, signal?: AbortSignal): boolean {
  if (signal?.aborted) return true;
  return (
    (e instanceof DOMException && e.name === "AbortError") ||
    (e instanceof Error && e.name === "AbortError")
  );
}

async function fetchApiData<T>(
  path: string,
  signal?: AbortSignal,
): Promise<T | null> {
  const res = await fetch(path, { cache: "no-store", signal });
  const json = await readApiJson(res);
  if (!res.ok || !json.ok || json.data == null) return null;
  return json.data as T;
}

async function fetchStaticJson<T>(
  path: string,
  signal?: AbortSignal,
): Promise<T | null> {
  const res = await fetch(path, { signal, cache: "default" });
  if (!res.ok) return null;
  return (await res.json()) as T;
}

export async function loadCoreMapFromApi(signal?: AbortSignal): Promise<{
  mapData: MapData;
  sido: AdminLayer;
  sigungu: AdminLayer;
} | null> {
  try {
    const [mapData, sido, sigungu] = await Promise.all([
      fetchApiData<MapData>("/api/map/data", signal),
      fetchApiData<AdminLayer>("/api/map/admin/sido", signal),
      fetchApiData<AdminLayer>("/api/map/admin/sigungu", signal),
    ]);
    if (
      isUsableMapData(mapData) &&
      isUsableLayer(sido) &&
      isUsableLayer(sigungu)
    ) {
      return { mapData, sido, sigungu };
    }
  } catch (e) {
    if (isAbortError(e, signal)) throw e;
  }
  return null;
}

export async function loadCoreMapFromStatic(signal?: AbortSignal): Promise<{
  mapData: MapData;
  sido: AdminLayer;
  sigungu: AdminLayer;
} | null> {
  try {
    const [mapData, sido, sigungu] = await Promise.all([
      fetchStaticJson<MapData>("/data/map-data.json", signal),
      fetchStaticJson<AdminLayer>("/data/admin-sido.json", signal),
      fetchStaticJson<AdminLayer>("/data/admin-sigungu.json", signal),
    ]);
    if (
      isUsableMapData(mapData) &&
      isUsableLayer(sido) &&
      isUsableLayer(sigungu)
    ) {
      return { mapData, sido, sigungu };
    }
  } catch (e) {
    if (isAbortError(e, signal)) throw e;
  }
  return null;
}

export async function loadAdminLayer(
  level: "sido" | "sigungu" | "emd",
  signal?: AbortSignal,
): Promise<AdminLayer | null> {
  try {
    const fromApi = await fetchApiData<AdminLayer>(
      `/api/map/admin/${level}`,
      signal,
    );
    if (isUsableLayer(fromApi)) return fromApi;
  } catch (e) {
    if (isAbortError(e, signal)) throw e;
  }
  try {
    const fromStatic = await fetchStaticJson<AdminLayer>(
      `/data/admin-${level}.json`,
      signal,
    );
    if (isUsableLayer(fromStatic)) return fromStatic;
  } catch (e) {
    if (isAbortError(e, signal)) throw e;
  }
  return null;
}

export async function loadMapBundleFromApi(signal?: AbortSignal): Promise<{
  mapData: MapData;
  layers: { sido: AdminLayer; sigungu: AdminLayer; emd: AdminLayer };
}> {
  const [mapData, sido, sigungu, emd] = await Promise.all([
    fetchApiData<MapData>("/api/map/data", signal),
    fetchApiData<AdminLayer>("/api/map/admin/sido", signal),
    fetchApiData<AdminLayer>("/api/map/admin/sigungu", signal),
    fetchApiData<AdminLayer>("/api/map/admin/emd", signal),
  ]);
  if (
    !isUsableMapData(mapData) ||
    !isUsableLayer(sido) ||
    !isUsableLayer(sigungu) ||
    !isUsableLayer(emd)
  ) {
    throw new Error("맵 API 응답이 올바르지 않습니다");
  }
  return {
    mapData,
    layers: { sido, sigungu, emd },
  };
}
