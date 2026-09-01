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
  observed_at?: unknown;
  weather_source: WeatherSource;
  sample_weather: SampleWeather;
  n_regions: number;
  note: string;
  scenario_summary?: string;
  model_metrics?: { roc_auc: unknown; pr_auc: unknown };
  regions: DailyRiskRegion[];
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

export type ScenarioBaselineWeather = {
  temp_avg: number;
  humidity_avg: number;
  wind_avg: number;
  precip: number;
};

export type ScenarioBaselineDto = {
  month: number;
  weather: ScenarioBaselineWeather;
  presets?: Record<string, ScenarioBaselineWeather>;
  source: string;
  start_date?: string | null;
  end_date?: string | null;
  n_rows?: number;
  n_years?: number;
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
