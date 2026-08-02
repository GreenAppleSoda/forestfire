export type JsonObject = Record<string, unknown>;

export type WeatherSource = "kma" | "open_meteo" | "manual" | "local" | "unknown";

export type SampleWeather = {
  temp_avg: number | null;
  precip: number | null;
  wind_avg: number | null;
  humidity_avg: number | null;
};

export type DailyRiskRegion = {
  code: string;
  name: unknown;
  province: unknown;
  ml_risk: unknown;
  ml_risk_norm: unknown;
  humidity_avg?: unknown;
  temp_avg?: unknown;
  precip?: unknown;
  wind_avg?: unknown;
};

export type DailyRiskDto = {
  predict_date: unknown;
  weather_source: WeatherSource;
  sample_weather: SampleWeather;
  n_regions: number;
  note: string;
  scenario_summary?: string;
  model_metrics?: { roc_auc: unknown; pr_auc: unknown };
  regions: DailyRiskRegion[];
};

export type MlScoresDto = {
  model: unknown;
  test_start: unknown;
  note: string;
  metrics?: { roc_auc: unknown; pr_auc: unknown };
  regions: Array<{
    code: string;
    name: unknown;
    province: unknown;
    ml_risk: unknown;
    ml_risk_norm: unknown;
  }>;
};

export type PredictDailyBody = {
  source?: string;
  force?: boolean;
  date?: string;
  weather?: JsonObject;
  temp_avg?: number;
  precip?: number;
  wind_avg?: number;
  humidity_avg?: number;
};

export type PredictScenarioBody = {
  year?: number | string;
  month?: number | string;
  weather?: JsonObject;
  preset?: string;
};

export type PredictResult =
  | { ok: true; data: DailyRiskDto | null; cached: boolean; status: 200 }
  | { ok: false; error: string; status: number };

export type FlaskJson = JsonObject & {
  ok?: boolean;
  error?: string;
  detail?: unknown;
  data?: unknown;
};

export type MountainHit = {
  id: string;
  name: unknown;
  height: unknown;
  address: string;
  fire_count: number;
  lon: unknown;
  lat: unknown;
  svg_x: unknown;
  svg_y: unknown;
};
