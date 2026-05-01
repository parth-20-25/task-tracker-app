const {
  buildFixtureAnalyticsDataset,
  getWorkflowHealth,
} = require("./analyticsCoreService");

const MIN_VIABLE_DATASET_SIZE = 30;
const MAX_HISTORY_ITEMS = 24;

function roundNumber(value, decimals = 2) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) {
    return null;
  }

  const factor = 10 ** decimals;
  return Math.round(Number(value) * factor) / factor;
}

function clamp(value, minimum = 0, maximum = 1) {
  return Math.max(minimum, Math.min(maximum, value));
}

function ratio(numerator, denominator, decimals = 4) {
  if (!denominator) {
    return 0;
  }

  return roundNumber(numerator / denominator, decimals) || 0;
}

function average(values) {
  if (!values.length) {
    return 0;
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function stageKey(stageName) {
  return String(stageName || "").trim().toLowerCase() || "workflow_stage";
}

function computeStageBenchmarks(completedEntries) {
  const stageDurations = new Map();
  const stageReworkCounts = new Map();
  const stageCounts = new Map();

  for (const entry of completedEntries) {
    for (const stage of entry.stages) {
      if (!stage.reliable) {
        continue;
      }

      const key = stageKey(stage.stage_name);
      if (!stageDurations.has(key)) {
        stageDurations.set(key, []);
      }

      if (Number(stage.duration) > 0) {
        stageDurations.get(key).push(Number(stage.duration));
      }

      stageCounts.set(key, (stageCounts.get(key) || 0) + 1);
      if (Number(entry.total_reworks || 0) > 0) {
        stageReworkCounts.set(key, (stageReworkCounts.get(key) || 0) + 1);
      }
    }
  }

  const stageBenchmarks = new Map();
  for (const [key, durations] of stageDurations.entries()) {
    stageBenchmarks.set(key, {
      avg_duration_minutes: roundNumber(average(durations), 2) || 0,
      rework_rate: ratio(stageReworkCounts.get(key) || 0, stageCounts.get(key) || 0, 4),
    });
  }

  return stageBenchmarks;
}

function computeUserBenchmarks(completedEntries) {
  const users = new Map();

  for (const entry of completedEntries) {
    if (!users.has(entry.user_id)) {
      users.set(entry.user_id, {
        user_name: entry.user_name,
        durations: [],
        measurable_items: 0,
        on_time_items: 0,
        reworked_items: 0,
      });
    }

    const user = users.get(entry.user_id);
    if (Number(entry.total_duration) > 0) {
      user.durations.push(Number(entry.total_duration));
    }

    if (entry.deadline && entry.final_completed_at) {
      user.measurable_items += 1;
      user.on_time_items += entry.is_delayed ? 0 : 1;
    }

    if (Number(entry.total_reworks || 0) > 0) {
      user.reworked_items += 1;
    }
  }

  const benchmarks = new Map();
  for (const [userId, user] of users.entries()) {
    benchmarks.set(userId, {
      user_name: user.user_name,
      avg_duration_minutes: roundNumber(average(user.durations), 2) || 0,
      on_time_rate: ratio(user.on_time_items, user.measurable_items, 4),
      rework_rate: ratio(user.reworked_items, user.durations.length, 4),
    });
  }

  return benchmarks;
}

function computeAverageReworkDelay(completedEntries) {
  const reworkedDurations = completedEntries
    .filter((entry) => Number(entry.total_reworks || 0) > 0 && Number(entry.total_duration || 0) > 0)
    .map((entry) => Number(entry.total_duration));
  const cleanDurations = completedEntries
    .filter((entry) => Number(entry.total_reworks || 0) === 0 && Number(entry.total_duration || 0) > 0)
    .map((entry) => Number(entry.total_duration));

  if (!reworkedDurations.length || !cleanDurations.length) {
    return 0;
  }

  return Math.max(0, (average(reworkedDurations) - average(cleanDurations)));
}

function getCurrentStageElapsedMinutes(entry, now) {
  const currentStage = [...entry.stages].reverse().find((stage) => !stage.completed_at);
  if (!currentStage?.assigned_at) {
    return 0;
  }

  const start = new Date(currentStage.assigned_at);
  if (Number.isNaN(start.getTime()) || now < start) {
    return 0;
  }

  return Math.round((now.getTime() - start.getTime()) / 60000);
}

function estimateRemainingMinutes(entry, stageBenchmarks, userBenchmarks, globalAverageDuration, averageReworkDelay, now) {
  const userBenchmark = userBenchmarks.get(entry.user_id);
  const currentStageName = entry.current_stage_name;
  const currentStageBenchmark = stageBenchmarks.get(stageKey(currentStageName));
  const currentStageElapsed = getCurrentStageElapsedMinutes(entry, now);
  const baseCurrentStageMinutes = currentStageBenchmark?.avg_duration_minutes || 0;
  const baseTotalMinutes = userBenchmark?.avg_duration_minutes || globalAverageDuration || baseCurrentStageMinutes;
  const baseRemainingMinutes = entry.total_stages > 1 && entry.current_stage_order > 0
    ? baseTotalMinutes * ((entry.total_stages - entry.completed_stages) / entry.total_stages)
    : baseTotalMinutes;

  const stageRemainder = Math.max(baseCurrentStageMinutes, currentStageElapsed, baseRemainingMinutes);
  const currentStageReworkRate = currentStageBenchmark?.rework_rate || userBenchmark?.rework_rate || 0;
  const reworkProbability = clamp((currentStageReworkRate * 0.65) + ((userBenchmark?.rework_rate || 0) * 0.35), 0, 1);
  const predictedRemainingMinutes = Math.max(0, stageRemainder + (averageReworkDelay * reworkProbability));

  return {
    predictedRemainingMinutes: Math.round(predictedRemainingMinutes),
    reworkProbability: roundNumber(reworkProbability, 4) || 0,
  };
}

function buildRiskReasons(entry, userBenchmarks, currentStageBenchmark, delayRisk, reworkProbability, bottleneckStage) {
  const reasons = [];
  const userBenchmark = userBenchmarks.get(entry.user_id);

  if (entry.current_stage_name && bottleneckStage && stageKey(entry.current_stage_name) === stageKey(bottleneckStage)) {
    reasons.push(`Currently in bottleneck stage (${entry.current_stage_name})`);
  }

  if (userBenchmark?.on_time_rate !== undefined && userBenchmark.on_time_rate < 0.6) {
    reasons.push("Assigned user has low historical on-time rate");
  }

  if (userBenchmark?.rework_rate !== undefined && userBenchmark.rework_rate >= 0.3) {
    reasons.push("Assigned user has elevated rework frequency");
  }

  if (currentStageBenchmark?.rework_rate !== undefined && currentStageBenchmark.rework_rate >= 0.25) {
    reasons.push(`Current stage (${entry.current_stage_name}) shows elevated rework history`);
  }

  if (Number(entry.total_reworks || 0) > 0) {
    reasons.push(`${entry.total_reworks} prior rework event(s) already recorded`);
  }

  if (entry.deadline && delayRisk >= 0.7) {
    reasons.push("Predicted completion is likely to exceed the due date");
  }

  if (!reasons.length) {
    reasons.push(reworkProbability >= 0.25 ? "Moderate rework signal from historical data" : "No elevated historical risk signals detected");
  }

  return reasons.slice(0, 4);
}

function classifyRisk(delayRisk) {
  if (delayRisk >= 0.7) {
    return "HIGH";
  }

  if (delayRisk >= 0.35) {
    return "MEDIUM";
  }

  return "LOW";
}

function buildPredictionHistory(completedEntries, stageBenchmarks, userBenchmarks, globalAverageDuration, averageReworkDelay) {
  return completedEntries
    .filter((entry) => Number(entry.total_duration || 0) > 0)
    .map((entry) => {
      const stageBenchmark = stageBenchmarks.get(stageKey(entry.current_stage_name));
      const userBenchmark = userBenchmarks.get(entry.user_id);
      const predicted = Math.round(
        userBenchmark?.avg_duration_minutes
        || stageBenchmark?.avg_duration_minutes
        || globalAverageDuration,
      );
      const actual = Math.round(Number(entry.total_duration || 0));
      const reworkPenalty = Number(entry.total_reworks || 0) > 0 ? averageReworkDelay : 0;
      const adjustedPrediction = Math.max(0, predicted + Math.round(reworkPenalty));
      const error = Math.abs(adjustedPrediction - actual);

      return {
        fixture_id: entry.entity_id,
        predicted: adjustedPrediction,
        actual,
        error,
        recorded_at: entry.final_completed_at ? new Date(entry.final_completed_at).toISOString() : new Date().toISOString(),
      };
    })
    .sort((left, right) => new Date(right.recorded_at).getTime() - new Date(left.recorded_at).getTime())
    .slice(0, MAX_HISTORY_ITEMS)
    .reverse();
}

async function buildPredictiveInsights(filters, user) {
  const dataset = await buildFixtureAnalyticsDataset(filters, user);
  const completedEntries = dataset.filter((entry) => entry.final_completed_at);
  const activeEntries = dataset.filter((entry) => !entry.final_completed_at);

  if (completedEntries.length < MIN_VIABLE_DATASET_SIZE) {
    return {
      predictions: [],
      model_metadata: {
        data_points_used: completedEntries.length,
        avg_prediction_error_minutes: 0,
        evaluated_predictions: 0,
        last_updated: new Date().toISOString(),
        is_viable: false,
        message: `Insufficient completed workflow items: ${completedEntries.length} available, ${MIN_VIABLE_DATASET_SIZE} required.`,
        active_fixtures_count: activeEntries.length,
      },
    };
  }

  const now = new Date();
  const stageBenchmarks = computeStageBenchmarks(completedEntries);
  const userBenchmarks = computeUserBenchmarks(completedEntries);
  const averageReworkDelay = computeAverageReworkDelay(completedEntries);
  const globalAverageDuration = roundNumber(average(completedEntries.map((entry) => Number(entry.total_duration || 0))), 2) || 0;
  const workflowHealth = await getWorkflowHealth(filters, user);
  const bottleneckStage = Object.entries(
    completedEntries.reduce((accumulator, entry) => {
      for (const stage of entry.stages) {
        if (!stage.reliable || Number(stage.duration) <= 0) {
          continue;
        }

        const key = stage.stage_name;
        accumulator[key] = accumulator[key] || [];
        accumulator[key].push(Number(stage.duration));
      }

      return accumulator;
    }, {}),
  )
    .map(([name, durations]) => ({ name, average: average(durations) }))
    .sort((left, right) => right.average - left.average)[0]?.name || null;

  const predictions = activeEntries
    .map((entry) => {
      const currentStageBenchmark = stageBenchmarks.get(stageKey(entry.current_stage_name));
      const { predictedRemainingMinutes, reworkProbability } = estimateRemainingMinutes(
        entry,
        stageBenchmarks,
        userBenchmarks,
        globalAverageDuration,
        averageReworkDelay,
        now,
      );
      const elapsedMinutes = getCurrentStageElapsedMinutes(entry, now);
      const deadlineMinutesRemaining = entry.deadline
        ? Math.round((new Date(entry.deadline).getTime() - now.getTime()) / 60000)
        : null;
      const deadlinePressure = deadlineMinutesRemaining === null
        ? 0
        : clamp(predictedRemainingMinutes / Math.max(deadlineMinutesRemaining, 1), 0, 1.5);
      const userDelaySignal = 1 - (userBenchmarks.get(entry.user_id)?.on_time_rate || 0.5);
      const stabilitySignal = 1 - clamp((workflowHealth.breakdown.stability || 0) / 100, 0, 1);
      const delayRisk = roundNumber(
        clamp((deadlinePressure * 0.5) + (reworkProbability * 0.25) + (userDelaySignal * 0.15) + (stabilitySignal * 0.1), 0, 1),
        4,
      ) || 0;

      return {
        fixture_no: entry.entity_label,
        item_label: entry.entity_label,
        fixture_id: entry.entity_id,
        user_name: entry.user_name,
        user_id: entry.user_id,
        predicted_completion_minutes: Math.max(Math.round(predictedRemainingMinutes), elapsedMinutes),
        delay_risk: delayRisk,
        rework_probability: reworkProbability,
        risk_level: classifyRisk(delayRisk),
        risk_reasons: buildRiskReasons(
          entry,
          userBenchmarks,
          currentStageBenchmark,
          delayRisk,
          reworkProbability,
          bottleneckStage,
        ),
        current_progress: {
          stages_completed: entry.completed_stages,
          total_stages: entry.total_stages,
          current_reworks: Number(entry.total_reworks || 0),
          elapsed_minutes: elapsedMinutes,
        },
      };
    })
    .sort((left, right) => right.delay_risk - left.delay_risk || left.fixture_no.localeCompare(right.fixture_no));

  const prediction_history = buildPredictionHistory(
    completedEntries,
    stageBenchmarks,
    userBenchmarks,
    globalAverageDuration,
    averageReworkDelay,
  );
  const avgPredictionError = roundNumber(
    average(prediction_history.map((item) => Number(item.error || 0))),
    2,
  ) || 0;

  return {
    predictions,
    risk_summary: {
      high: predictions.filter((prediction) => prediction.risk_level === "HIGH").length,
      medium: predictions.filter((prediction) => prediction.risk_level === "MEDIUM").length,
      low: predictions.filter((prediction) => prediction.risk_level === "LOW").length,
    },
    prediction_history,
    model_metadata: {
      data_points_used: completedEntries.length,
      avg_prediction_error_minutes: avgPredictionError,
      evaluated_predictions: prediction_history.length,
      last_updated: new Date().toISOString(),
      is_viable: true,
      active_fixtures_count: activeEntries.length,
      cross_module_signals: {
        rework_intelligence: {
          avg_rework_cost: roundNumber(averageReworkDelay, 2) || 0,
          rework_rate: ratio(
            completedEntries.filter((entry) => Number(entry.total_reworks || 0) > 0).length,
            completedEntries.length,
            4,
          ),
        },
        deadline_reliability: {
          planning_error_avg: roundNumber(average(
            completedEntries
              .filter((entry) => entry.deadline && entry.final_completed_at)
              .map((entry) => Number(entry.planning_error_minutes || 0)),
          ), 2) || 0,
          delay_frequency: ratio(
            completedEntries.filter((entry) => entry.deadline && entry.final_completed_at && entry.is_delayed).length,
            completedEntries.filter((entry) => entry.deadline && entry.final_completed_at).length,
            4,
          ),
        },
        stage_efficiency: {
          bottleneck_stage: bottleneckStage || "N/A",
        },
        workflow_health: {
          stability_factor: roundNumber((workflowHealth.breakdown.stability || 0) / 100, 4) || 0,
        },
      },
    },
  };
}

module.exports = {
  buildPredictiveInsights,
};
