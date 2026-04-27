import { apiRequest } from "@/api/http";

// ─── Types ───────────────────────────────────────────────────────────────────

export type RiskLevel = "LOW" | "MEDIUM" | "HIGH";

export interface FixturePrediction {
  fixture_no: string;
  fixture_id: string;
  user_name: string;
  user_id: string;
  predicted_completion_minutes: number;
  delay_risk: number;
  rework_probability: number;
  risk_level: RiskLevel;
  risk_reasons: string[];
  current_progress: {
    stages_completed: number;
    total_stages: number;
    current_reworks: number;
    elapsed_minutes: number;
  };
}

export interface RiskSummary {
  high: number;
  medium: number;
  low: number;
}

export interface PredictionHistoryEntry {
  fixture_id: string;
  predicted: number;
  actual: number;
  error: number;
  recorded_at: string;
}

export interface CrossModuleSignals {
  rework_intelligence: {
    avg_rework_cost: number;
    rework_rate: number;
  };
  deadline_reliability: {
    planning_error_avg: number;
    delay_frequency: number;
  };
  stage_efficiency: {
    bottleneck_stage: string;
  };
  workflow_health: {
    stability_factor: number;
  };
}

export interface ModelMetadata {
  data_points_used: number;
  avg_prediction_error_minutes: number;
  evaluated_predictions?: number;
  last_updated: string;
  is_viable: boolean;
  message?: string;
  active_fixtures_count: number;
  cross_module_signals?: CrossModuleSignals;
}

export interface PredictiveInsightsPayload {
  predictions: FixturePrediction[];
  risk_summary?: RiskSummary;
  prediction_history?: PredictionHistoryEntry[];
  model_metadata: ModelMetadata;
}

export interface PredictiveInsightsFilters {
  departmentId?: string;
  scopeId?: string;
  projectId?: string;
}

// ─── Fetch ───────────────────────────────────────────────────────────────────

export function fetchPredictiveInsights(
  filters: PredictiveInsightsFilters = {},
): Promise<PredictiveInsightsPayload> {
  const params = new URLSearchParams();
  if (filters.departmentId) params.append("departmentId", filters.departmentId);
  if (filters.scopeId) params.append("scopeId", filters.scopeId);
  if (filters.projectId) params.append("projectId", filters.projectId);

  const query = params.toString();
  return apiRequest<PredictiveInsightsPayload>(
    `/analytics/predictive-insights${query ? `?${query}` : ""}`,
  );
}
