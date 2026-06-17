const { normalizeDesignStageName } = require("../../lib/designWorkflowStages");
const {
  DEFAULT_DESIGN_STAGE_WEIGHTS,
} = require("../../config/designCompletionWeights");

function normalizeWeightRows(rows = []) {
  return rows
    .map((row) => ({
      stage_key: normalizeDesignStageName(row.stage_key || row.stage_name),
      weight_percent: Number(row.weight_percent),
    }))
    .filter((row) => row.stage_key && Number.isFinite(row.weight_percent) && row.weight_percent > 0);
}

function buildWeightMapForStageKeys(stageKeys, overrideRows = []) {
  const overrideMap = new Map(
    normalizeWeightRows(overrideRows).map((row) => [row.stage_key, row.weight_percent]),
  );

  const resolved = stageKeys.map((stageKey) => ({
    stage_key: stageKey,
    weight_percent: overrideMap.get(stageKey) ?? DEFAULT_DESIGN_STAGE_WEIGHTS[stageKey] ?? 0,
  }));

  const positive = resolved.filter((row) => row.weight_percent > 0);
  if (positive.length === 0) {
    const even = stageKeys.length > 0 ? 100 / stageKeys.length : 0;
    return new Map(stageKeys.map((stageKey) => [stageKey, even]));
  }

  const total = positive.reduce((sum, row) => sum + row.weight_percent, 0);
  if (Math.abs(total - 100) < 0.01) {
    return new Map(positive.map((row) => [row.stage_key, row.weight_percent]));
  }

  const scale = 100 / total;
  return new Map(
    positive.map((row) => [row.stage_key, Math.round(row.weight_percent * scale * 1000) / 1000]),
  );
}

function resolveStageKeysFromProgress(progressRows = [], workflowStages = []) {
  const keys = new Set();
  const orderByKey = new Map();

  for (const row of progressRows) {
    const key = normalizeDesignStageName(row.stage_name);
    if (key) {
      keys.add(key);
      orderByKey.set(key, Number(row.stage_order || orderByKey.get(key) || 0));
    }
  }

  workflowStages.forEach((stage, index) => {
    const key = normalizeDesignStageName(stage.stage_name || stage.name);
    if (key) {
      keys.add(key);
      if (!orderByKey.has(key) || orderByKey.get(key) === 0) {
        orderByKey.set(key, Number(stage.order ?? stage.sequence_order ?? index + 1));
      }
    }
  });

  return [...keys].sort((left, right) => {
    return Number(orderByKey.get(left) || 0) - Number(orderByKey.get(right) || 0);
  });
}

module.exports = {
  buildWeightMapForStageKeys,
  resolveStageKeysFromProgress,
};
