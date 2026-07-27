export type MountainInfo = {
  id: string;
  name: string;
  height: number | null;
  address: string;
  details: string;
  notable: string;
  admin: string;
  admin_tel: string;
  fire_count: number;
  /** WGS84 */
  lon?: number | null;
  lat?: number | null;
  /** 지도 SVG 좌표 (EPSG:5179 → viewBox) */
  svg_x?: number | null;
  svg_y?: number | null;
};

export type FireEvent = {
  datetime: string;
  region: string;
  city: string;
  town: string;
  village: string;
  damage_area: number;
  mountains: string;
  mountain_list?: MountainInfo[];
  match_level: string;
};

export type RegionStat = {
  code: string;
  name: string;
  province?: string;
  province_name?: string;
  fire_count: number;
  risk_score: number;
  risk_tier: string;
  large_fire_pct: number;
  intensity: number;
  color: string;
  center: [number, number];
  mountain_count?: number;
  top_mountains?: MountainInfo[];
  catalog_mountains?: MountainInfo[];
};

export type ProvinceStat = RegionStat;

export type ProbMarker = {
  code: string;
  name: string;
  province: string;
  province_name: string;
  fire_count: number;
  /** 향후 1년 내 산불 1건+ 추정 확률 0~1 */
  prob: number;
  color: string;
  x: number;
  y: number;
  r: number;
};

export type AdminRegion = ProbMarker & {
  d: string;
  fill: string;
  label: [number, number];
};

export type AdminLayer = {
  level: "sido" | "sigungu" | "emd" | "li";
  viewBox: [number, number];
  regions: AdminRegion[];
  markers: ProbMarker[];
  meta: {
    n_regions: number;
    n_markers: number;
    max_fire_count: number;
    prob_note: string;
  };
};

export type MapData = {
  meta: {
    source: string;
    unit: string;
    color: string;
    total_fires: number;
    total_mountains?: number;
    matched_fires?: number;
    regions?: number;
    regions_with_fires?: number;
  };
  provinces: RegionStat[];
  regions?: RegionStat[];
  history: Record<string, FireEvent[]>;
  mountains?: Record<string, MountainInfo>;
};

export type KoreaPaths = {
  viewBox: [number, number];
  fit?: { x: number; y: number; w: number; h: number };
  regions: Array<{
    code: string;
    name: string;
    province?: string;
    d: string;
    label: [number, number];
  }>;
};

export type GeoFeatureCollection = {
  type: "FeatureCollection";
  features: Array<{
    type: "Feature";
    properties: {
      name: string;
      name_eng?: string;
      code?: string;
      base_year?: string;
    };
    geometry: {
      type: "Polygon" | "MultiPolygon";
      coordinates: number[][][] | number[][][][];
    };
  }>;
};

export type AdminLevel = "sido" | "sigungu" | "emd" | "li";

export type RiskMode = "history" | "daily" | "scenario";

/** 행정구역 코로플레스(SVG) ↔ 카카오 위성 */
export type MapDisplayMode = "choropleth" | "satellite";

export type SigunguMlRegion = {
  code: string;
  name: string;
  province: string;
  ml_risk: number;
  ml_risk_norm: number;
  test_fire_days?: number;
  humidity_min?: number;
  temp_avg?: number;
  precip?: number;
  wind_avg?: number;
};

export type SigunguMlScores = {
  model?: string;
  test_start?: string;
  predict_date?: string;
  weather_source?: string;
  sample_weather?: Record<string, number | null>;
  metrics?: {
    roc_auc: number;
    pr_auc: number;
    precision?: number;
    recall?: number;
    f1?: number;
    threshold?: number;
  };
  model_metrics?: {
    roc_auc?: number;
    pr_auc?: number;
    threshold?: number;
  };
  note: string;
  regions: SigunguMlRegion[];
};

export type DailyMlRisk = SigunguMlScores & {
  predict_date: string;
  weather_source: string;
  sample_weather?: Record<string, number | null>;
  n_regions?: number;
  scenario_summary?: string;
  /** recent_obs(≤7일) | prior_year_month(≥8일) */
  antecedent_weather_mode?: string;
  horizon_days?: number;
  near_horizon_days?: number;
};

