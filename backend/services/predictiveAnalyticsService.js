const {
  buildFixtureAnalyticsDataset,
} = require("./analyticsCoreService");

const MIN_VIABLE_DATASET_SIZE = 30;

// ─── In-memory accuracy tracker (per-process, resets on restart) ─────────────

const predictionLog = [];

// ─── Helpers ─────────────────────────────────────────────────────────────────

function safeDiv(numerator, denominator, fallback = 0) {
  return denominator > 0 ? numerator / denominator : fallback;
}

function clamp01(v) {
  return Math.min(1, Math.max(0, v));
}

function stdDev(arr) {
  if (!arr.length) return 0;
  const mean = arr.reduce((s, v) => s + v, 0) / arr.length;
  const variance = arr.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / arr.length;
  return Math.sqrt(variance);
}

function classifyRisk(score) {
  if (score > 0.7) return "HIGH";
  if (score >= 0.3) return "MEDIUM";
  return "LOW";
}

function deriveModuleMetrics(completedFixtures, stageNames) {
  // ── 1. Rework Intelligence ──────────────────────────────────────────────
  const totalReworks = completedFixtures.reduce((s, d) => s + d.total_reworks, 0);
  const fixturesWithRework = completedFixtures.filter((d) => d.total_reworks > 0);
  const rework_rate = safeDiv(fixturesWithRework.length, completedFixtures.length);

  const fixturesWithoutRework = completedFixtures.filter((d) => d.total_reworks === 0);
  const avgDurationNoRework = fixturesWithoutRework.length > 0
    ? fixturesWithoutRework.reduce((s, d) => s + d.total_duration, 0) / fixturesWithoutRework.length
    : 0;

  let avg_rework_cost = 0;
  if (fixturesWithRework.length > 0 && avgDurationNoRework > 0) {
    const totalExtraDuration = fixturesWithRework.reduce(
      (s, d) => s + Math.max(0, d.total_duration - avgDurationNoRework),
      0
    );
    const totalReworkEvents = fixturesWithRework.reduce((s, d) => s + d.total_reworks, 0);
    avg_rework_cost = safeDiv(totalExtraDuration, totalReworkEvents);
  }

  // Per-stage rework rates
  const stageReworkCounts = {};
  const stageTotalCounts = {};
  stageNames.forEach((name) => {
    stageReworkCounts[name] = 0;
    stageTotalCounts[name] = 0;
  });

  completedFixtures.forEach((d) => {
    d.stages.forEach((st) => {
      if (st.duration > 0 || st.attempts > 0) {
        stageTotalCounts[st.stage_name] = (stageTotalCounts[st.stage_name] || 0) + 1;
        if (st.attempts > 1) {
          stageReworkCounts[st.stage_name] = (stageReworkCounts[st.stage_name] || 0) + 1;
        }
      }
    });
  });

  const stage_rework_rates = {};
  stageNames.forEach((name) => {
    stage_rework_rates[name] = safeDiv(stageReworkCounts[name], stageTotalCounts[name]);
  });

  // ── 2. Deadline Reliability ─────────────────────────────────────────────
  const measurable = completedFixtures.filter((d) => d.deadline && d.final_completed_at);
  const delayed = measurable.filter((d) => d.is_delayed);
  const delay_frequency = safeDiv(delayed.length, measurable.length);

  const planningErrors = measurable.map((d) => {
    const completedMs = new Date(d.final_completed_at).getTime();
    const deadlineMs = new Date(d.deadline).getTime();
    return Math.round((completedMs - deadlineMs) / 60000);
  });
  const planning_error_avg = planningErrors.length > 0
    ? planningErrors.reduce((s, v) => s + v, 0) / planningErrors.length
    : 0;

  // ── 3. Stage Efficiency ─────────────────────────────────────────────────
  const stageDurationSums = {};
  const stageDurationCounts = {};
  stageNames.forEach((name) => {
    stageDurationSums[name] = 0;
    stageDurationCounts[name] = 0;
  });

  completedFixtures.forEach((d) => {
    d.stages.forEach((st) => {
      if (st.duration > 0) {
        stageDurationSums[st.stage_name] = (stageDurationSums[st.stage_name] || 0) + st.duration;
        stageDurationCounts[st.stage_name] = (stageDurationCounts[st.stage_name] || 0) + 1;
      }
    });
  });

  const avg_stage_duration = {};
  let bottleneck_stage = stageNames[0];
  let maxAvgDur = -1;

  stageNames.forEach((name) => {
    const avg = safeDiv(stageDurationSums[name], stageDurationCounts[name]);
    avg_stage_duration[name] = avg;
    if (avg > maxAvgDur) {
      maxAvgDur = avg;
      bottleneck_stage = name;
    }
  });

  // ── 4. User Performance ─────────────────────────────────────────────────
  const userMap = new Map();

  completedFixtures.forEach((d) => {
    const userId = d.user_id;
    const name = d.user_name || "Unknown";
    if (!userMap.has(userId)) {
      userMap.set(userId, {
        name,
        total_duration: 0,
        count: 0,
        total_reworks: 0,
        delayed_count: 0,
        measurable_count: 0,
      });
    }
    const ds = userMap.get(userId);
    ds.total_duration += d.total_duration;
    ds.count += 1;
    ds.total_reworks += d.total_reworks;
    if (d.deadline && d.final_completed_at) {
      ds.measurable_count += 1;
      if (d.is_delayed) ds.delayed_count += 1;
    }
  });

  const globalAvgDuration = safeDiv(
    completedFixtures.reduce((s, d) => s + d.total_duration, 0),
    completedFixtures.length
  );

  const user_metrics = {};
  userMap.forEach((stats, userId) => {
    const avgDur = safeDiv(stats.total_duration, stats.count);
    user_metrics[userId] = {
      name: stats.name,
      avg_duration: avgDur,
      efficiency: safeDiv(avgDur, globalAvgDuration, 1),
      rework_rate: safeDiv(stats.total_reworks, stats.count),
      delay_rate: safeDiv(stats.delayed_count, stats.measurable_count),
    };
  });

  // ── 5. Workflow Health — stability factor ───────────────────────────────
  const planningErrorStdDev = stdDev(planningErrors);
  const STD_DEV_CAP = 10080; 
  const stability_factor = clamp01(1 - Math.min(planningErrorStdDev, STD_DEV_CAP) / STD_DEV_CAP);

  return {
    avg_rework_cost,
    rework_rate,
    stage_rework_rates,
    planning_error_avg,
    delay_frequency,
    avg_stage_duration,
    bottleneck_stage,
    user_metrics,
    global_avg_duration: globalAvgDuration,
    stability_factor,
  };
}
function predictDuration(fixture, metrics) {
  let predicted = 0;

  fixture.stages.forEach((st) => {
    if (st.duration > 0) {
      predicted += st.duration;
    } else {
      predicted += metrics.avg_stage_duration[st.stage_name] || 0;
    }
  });

  const currentReworks = fixture.total_reworks;
  const remainingStages = fixture.stages.filter((st) => st.duration === 0);
  const expectedAdditionalReworks = remainingStages.reduce((s, st) => {
    return s + (metrics.stage_rework_rates[st.stage_name] || 0);
  }, 0);

  const rework_penalty = (currentReworks + expectedAdditionalReworks) * metrics.avg_rework_cost;
  predicted += rework_penalty;

  const userData = metrics.user_metrics[fixture.user_id];
  if (userData && userData.efficiency > 0) {
    predicted *= userData.efficiency;
  }

  return Math.round(Math.max(0, predicted));
}

function predictDelayRisk(fixture, metrics) {
  const userData = metrics.user_metrics[fixture.user_id];

  const globalReworkRate = metrics.rework_rate;
  const userReworkRate = userData ? userData.rework_rate : globalReworkRate;
  const reworkSignal = clamp01(userReworkRate);

  const userDelayRate = userData ? userData.delay_rate : metrics.delay_frequency;
  const delayHistorySignal = clamp01(userDelayRate);

  const completedStageCount = fixture.stages.filter(st => st.duration > 0).length;
  const totalStages = fixture.stages.length;
  const progressRatio = totalStages > 0 ? completedStageCount / totalStages : 1;

  const stageDelaySignal = clamp01(
    (1 - progressRatio) * 0.5 + (fixture.total_reworks > 0 ? 0.3 : 0) + (1 - metrics.stability_factor) * 0.2
  );

  const risk = 0.35 * reworkSignal + 0.35 * delayHistorySignal + 0.30 * stageDelaySignal;
  return parseFloat(clamp01(risk).toFixed(3));
}

function predictReworkProbability(fixture, metrics) {
  const userData = metrics.user_metrics[fixture.user_id];

  const remainingStages = fixture.stages.filter((st) => st.duration === 0);
  const avgStageReworkRate = remainingStages.length > 0
    ? remainingStages.reduce((s, st) => s + (metrics.stage_rework_rates[st.stage_name] || 0), 0) / remainingStages.length
    : 0;

  const userReworkRate = userData
    ? clamp01(userData.rework_rate) 
    : metrics.rework_rate;

  const prob = 0.6 * avgStageReworkRate + 0.4 * userReworkRate;
  return parseFloat(clamp01(prob).toFixed(3));
}

// ─── Risk reason generation ──────────────────────────────────────────────────

function generateRiskReasons(fixture, metrics, delayRisk, reworkProb) {
  const reasons = [];
  const userData = metrics.user_metrics[fixture.user_id];

  if (userData) {
    if (userData.rework_rate > metrics.rework_rate * 1.2) {
      reasons.push("High user rework rate");
    }
    if (userData.efficiency > 1.2) {
      reasons.push("User slower than average");
    }
    if (userData.delay_rate > metrics.delay_frequency * 1.2) {
      reasons.push("User delay history above average");
    }
  }

  const currentStageIdx = fixture.stages.findIndex(st => st.duration === 0);
  const bottleneckIdx = metrics.bottleneck_stage ? fixture.stages.findIndex(st => st.stage_name === metrics.bottleneck_stage) : -1;
  
  if (currentStageIdx >= 0 && bottleneckIdx >= 0 && currentStageIdx <= bottleneckIdx) {
    reasons.push(`Approaching bottleneck stage (${metrics.bottleneck_stage})`);
  }

  if (fixture.total_reworks > 0) {
    reasons.push(`${fixture.total_reworks} rework(s) already occurred`);
  }

  if (metrics.stability_factor < 0.5) {
    reasons.push("Low system stability");
  }

  if (reworkProb > 0.5) {
    reasons.push("High rework probability based on historical patterns");
  }

  if (reasons.length === 0) {
    if (delayRisk > 0.3) {
      reasons.push("Moderate risk from combined factors");
    } else {
      reasons.push("Within normal parameters");
    }
  }

  return reasons;
}

// ─── Self-correction tracking ────────────────────────────────────────────────

function recordPrediction(fixtureId, predictedDuration) {
  // Store for later comparison when fixture completes
  predictionLog.push({
    fixture_id: fixtureId,
    predicted_duration: predictedDuration,
    actual_duration: null,
    error: null,
    recorded_at: new Date().toISOString(),
  });

  // Keep log capped at 1000 entries
  if (predictionLog.length > 1000) {
    predictionLog.splice(0, predictionLog.length - 1000);
  }
}

function updateCompletedPredictions(completedFixtures) {
  const completedMap = new Map(completedFixtures.map((f) => [f.entity_id, f]));

  let updatedCount = 0;
  predictionLog.forEach((entry) => {
    if (entry.actual_duration === null && completedMap.has(entry.fixture_id)) {
      const actual = completedMap.get(entry.fixture_id);
      if (actual) {
        entry.actual_duration = actual.total_duration;
        entry.error = Math.abs(entry.predicted_duration - actual.total_duration);
        updatedCount += 1;
      }
    }
  });

  if (updatedCount > 0) {
    console.log(`[Predictive] Self-correction: updated ${updatedCount} prediction(s) with actuals`);
  }

  // Compute model accuracy
  const evaluated = predictionLog.filter((e) => e.error !== null);
  if (evaluated.length > 0) {
    const avgError = evaluated.reduce((s, e) => s + e.error, 0) / evaluated.length;

    // Check for degradation: compare last 20 vs previous 20
    if (evaluated.length >= 40) {
      const recent = evaluated.slice(-20);
      const previous = evaluated.slice(-40, -20);
      const recentAvgError = recent.reduce((s, e) => s + e.error, 0) / recent.length;
      const previousAvgError = previous.reduce((s, e) => s + e.error, 0) / previous.length;

      if (recentAvgError > previousAvgError * 1.15) {
        console.warn(
          `[Predictive] ⚠ Model accuracy degrading: recent avg error ${Math.round(recentAvgError)}min vs previous ${Math.round(previousAvgError)}min`
        );
      }
    }

    return { avg_prediction_error_minutes: Math.round(avgError), evaluated_count: evaluated.length };
  }

  return { avg_prediction_error_minutes: 0, evaluated_count: 0 };
}

// ─── Main entry point ────────────────────────────────────────────────────────

async function buildPredictiveInsights({ departmentId, scopeId, projectId }, user) {
  const dataset = await buildFixtureAnalyticsDataset({ departmentId, scopeId, projectId });

  const completed = dataset.filter((d) => d.final_completed_at);
  const active = dataset.filter((d) => !d.final_completed_at);

  const isViable = completed.length >= MIN_VIABLE_DATASET_SIZE;

  if (!isViable || dataset.length === 0) {
    return {
      predictions: [],
      model_metadata: {
        data_points_used: completed.length,
        avg_prediction_error_minutes: 0,
        last_updated: new Date().toISOString(),
        is_viable: false,
        message: `Insufficient data: ${completed.length} completed items (minimum ${MIN_VIABLE_DATASET_SIZE} required)`,
        active_fixtures_count: active.length,
      },
    };
  }

  // Extract all unique stage names present in the dataset
  const stageNames = Array.from(new Set(dataset.flatMap(d => d.stages.map(s => s.stage_name))));

  const metrics = deriveModuleMetrics(completed, stageNames);

  // Reconcile past predictions with actual results before emitting model metadata.
  const accuracyStats = updateCompletedPredictions(completed);

  const predictions = active.map((fixture) => {
    const predicted_completion_minutes = predictDuration(fixture, metrics);
    const delay_risk = predictDelayRisk(fixture, metrics);
    const rework_probability = predictReworkProbability(fixture, metrics);
    const risk_level = classifyRisk(delay_risk);
    const risk_reasons = generateRiskReasons(fixture, metrics, delay_risk, rework_probability);

    recordPrediction(fixture.entity_id, predicted_completion_minutes);

    return {
      fixture_no: fixture.fixture_no,
      fixture_id: fixture.entity_id,
      user_name: fixture.user_name,
      user_id: fixture.user_id,
      predicted_completion_minutes,
      delay_risk,
      rework_probability,
      risk_level,
      risk_reasons,
      current_progress: {
        stages_completed: fixture.stages.filter(st => st.duration > 0).length,
        total_stages: fixture.stages.length,
        current_reworks: fixture.total_reworks,
        elapsed_minutes: fixture.total_duration,
      },
    };
  });

  predictions.sort((a, b) => b.delay_risk - a.delay_risk);

  const predictionHistory = predictionLog
    .filter((e) => e.actual_duration !== null)
    .map((e) => ({
      fixture_id: e.fixture_id,
      predicted: e.predicted_duration,
      actual: e.actual_duration,
      error: e.error,
      recorded_at: e.recorded_at,
    }));

  return {
    predictions,
    risk_summary: {
      high: predictions.filter((p) => p.risk_level === "HIGH").length,
      medium: predictions.filter((p) => p.risk_level === "MEDIUM").length,
      low: predictions.filter((p) => p.risk_level === "LOW").length,
    },
    prediction_history: predictionHistory,
    model_metadata: {
      data_points_used: completed.length,
      avg_prediction_error_minutes: accuracyStats.avg_prediction_error_minutes,
      evaluated_predictions: accuracyStats.evaluated_count,
      last_updated: new Date().toISOString(),
      is_viable: true,
      active_fixtures_count: active.length,
      cross_module_signals: {
        rework_intelligence: {
          avg_rework_cost: Math.round(metrics.avg_rework_cost),
          rework_rate: parseFloat(metrics.rework_rate.toFixed(3)),
        },
        deadline_reliability: {
          planning_error_avg: Math.round(metrics.planning_error_avg),
          delay_frequency: parseFloat(metrics.delay_frequency.toFixed(3)),
        },
        stage_efficiency: {
          bottleneck_stage: metrics.bottleneck_stage,
        },
        workflow_health: {
          stability_factor: parseFloat(metrics.stability_factor.toFixed(3)),
        },
      },
    },
  };
}

module.exports = {
  buildPredictiveInsights,
};
