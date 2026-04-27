const ORDERED_DESIGN_STAGE_KEYS = ["concept", "dap", "3d_finish", "2d_finish", "release"];

const DESIGN_STAGE_DISPLAY_NAMES = {
  concept: "Concept",
  dap: "DAP",
  "3d_finish": "3D Finish",
  "2d_finish": "2D Finish",
  release: "Release",
};

function sanitizeStageName(stageName) {
  return String(stageName || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function normalizeDesignStageName(stageName) {
  const sanitized = sanitizeStageName(stageName);

  if (!sanitized) {
    return null;
  }

  if (["concept", "concept_stage"].includes(sanitized)) {
    return "concept";
  }

  if (["dap", "d_a_p"].includes(sanitized)) {
    return "dap";
  }

  if (["3d", "3d_finish", "three_d", "three_d_finish"].includes(sanitized)) {
    return "3d_finish";
  }

  if (["2d", "2d_finish", "two_d", "two_d_finish"].includes(sanitized)) {
    return "2d_finish";
  }

  if (["release", "released"].includes(sanitized)) {
    return "release";
  }

  return null;
}

function getDesignStageDisplayName(stageKey, fallbackName = null) {
  if (stageKey && DESIGN_STAGE_DISPLAY_NAMES[stageKey]) {
    return DESIGN_STAGE_DISPLAY_NAMES[stageKey];
  }

  return fallbackName || null;
}

function mapStagesByKey(stages = [], nameSelector) {
  const stageMap = new Map();

  for (const stage of stages) {
    const stageKey = normalizeDesignStageName(nameSelector(stage));
    if (stageKey && !stageMap.has(stageKey)) {
      stageMap.set(stageKey, stage);
    }
  }

  return stageMap;
}

function getOrderedDesignStageKeys(progressRows = [], workflowStages = []) {
  const progressByKey = mapStagesByKey(progressRows, (row) => row?.stage_name || row?.name);
  const workflowByKey = mapStagesByKey(workflowStages, (stage) => stage?.name || stage?.stage_name);
  const resolvedStageKeys = ORDERED_DESIGN_STAGE_KEYS.filter(
    (stageKey) => progressByKey.has(stageKey) || workflowByKey.has(stageKey),
  );

  return {
    orderedStageKeys: resolvedStageKeys.length > 0 ? resolvedStageKeys : [...ORDERED_DESIGN_STAGE_KEYS],
    progressByKey,
    workflowByKey,
  };
}

function getCurrentDesignStage(progressRows = [], workflowStages = []) {
  const {
    orderedStageKeys,
    progressByKey,
    workflowByKey,
  } = getOrderedDesignStageKeys(progressRows, workflowStages);

  for (let index = 0; index < orderedStageKeys.length; index += 1) {
    const stageKey = orderedStageKeys[index];
    const progressRow = progressByKey.get(stageKey) || null;
    const workflowStage = workflowByKey.get(stageKey) || null;

    if (!progressRow || progressRow.status !== "APPROVED") {
      return {
        stageKey,
        isComplete: false,
        currentStage: progressRow || {
          stage_name: getDesignStageDisplayName(stageKey, workflowStage?.name || workflowStage?.stage_name),
          stage_order: Number(workflowStage?.order ?? workflowStage?.sequence_order ?? index + 1),
          status: "PENDING",
          completed_at: null,
        },
        workflowStage,
      };
    }
  }

  return {
    stageKey: "completed",
    isComplete: true,
    currentStage: null,
    workflowStage: null,
  };
}

module.exports = {
  getOrderedDesignStageKeys,
  ORDERED_DESIGN_STAGE_KEYS,
  getCurrentDesignStage,
  getDesignStageDisplayName,
  normalizeDesignStageName,
};
