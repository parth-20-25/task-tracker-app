const ALLOWED_OUTSOURCE_STAGES = ["Concept", "3D", "2D"];
const OUTSOURCE_STATUSES = {
  OUTSOURCED: "outsourced",
  COMPLETED: "completed",
  BROUGHT_IN_HOUSE: "brought_in_house",
};
const OUTSOURCE_COMPLETION_IGNORED_STAGE_KEYS = new Set(["release"]);
const OUTSOURCE_STAGE_KEYS = new Map([
  ["Concept", "concept"],
  ["3D", "3d_finish"],
  ["2D", "2d_finish"],
]);

const STAGE_ALIASES = new Map([
  ["concept", "Concept"],
  ["3d", "3D"],
  ["3d_finish", "3D"],
  ["3dfinish", "3D"],
  ["3d finish", "3D"],
  ["2d", "2D"],
  ["2d_finish", "2D"],
  ["2dfinish", "2D"],
  ["2d finish", "2D"],
]);

function normalizeStageKey(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function normalizeSupplierName(value) {
  return String(value || "").trim().replace(/\s+/g, " ");
}

function canonicalizeOutsourceStage(value) {
  const raw = String(value || "").trim();
  const normalized = normalizeStageKey(raw);
  const canonical = STAGE_ALIASES.get(normalized) || STAGE_ALIASES.get(raw.toLowerCase());

  if (!canonical) {
    return null;
  }

  return canonical;
}

function normalizeOutsourceStages(value) {
  if (!Array.isArray(value)) {
    return {
      stages: [],
      error: "outsourced_stages must be an array",
    };
  }

  const seen = new Set();
  const stages = [];
  const invalid = [];

  value.forEach((stage) => {
    const canonical = canonicalizeOutsourceStage(stage);
    if (!canonical) {
      invalid.push(String(stage || "").trim() || "(blank)");
      return;
    }

    if (!seen.has(canonical)) {
      seen.add(canonical);
      stages.push(canonical);
    }
  });

  if (invalid.length > 0) {
    return {
      stages: [],
      error: `Invalid outsourced stage${invalid.length === 1 ? "" : "s"}: ${invalid.join(", ")}. Allowed stages are Concept, 3D, and 2D.`,
    };
  }

  if (stages.length === 0) {
    return {
      stages: [],
      error: "At least one outsourced stage is required",
    };
  }

  return { stages, error: null };
}

function normalizeOutsourceStatus(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return Object.values(OUTSOURCE_STATUSES).includes(normalized) ? normalized : null;
}

function mergeRecentSupplierNames(...groups) {
  const seen = new Set();
  const merged = [];

  groups.flat().forEach((supplier) => {
    const value = normalizeSupplierName(supplier);
    const key = value.toLowerCase();
    if (!value || seen.has(key)) {
      return;
    }

    seen.add(key);
    merged.push(value);
  });

  return merged.slice(0, 6);
}

function normalizeWorkflowStageKey(value) {
  const normalized = normalizeStageKey(value);
  if (["concept", "concept_stage"].includes(normalized)) {
    return "concept";
  }
  if (["dap", "d_a_p"].includes(normalized)) {
    return "dap";
  }
  if (["3d", "3d_finish", "three_d", "three_d_finish"].includes(normalized)) {
    return "3d_finish";
  }
  if (["2d", "2d_finish", "two_d", "two_d_finish"].includes(normalized)) {
    return "2d_finish";
  }
  if (["release", "released"].includes(normalized)) {
    return "release";
  }
  return normalized || null;
}

function getOutsourcedWorkflowStageKeys(outsourcedStages = []) {
  const keys = new Set();

  normalizeOutsourceStages(outsourcedStages).stages.forEach((stage) => {
    const stageKey = OUTSOURCE_STAGE_KEYS.get(stage);
    if (stageKey) {
      keys.add(stageKey);
    }
  });

  return keys;
}

function isOutsourcedWorkflowStage(stageName, outsourcedStages = []) {
  const stageKey = normalizeWorkflowStageKey(stageName);
  return Boolean(stageKey && getOutsourcedWorkflowStageKeys(outsourcedStages).has(stageKey));
}

function isApprovedWorkflowStatus(status) {
  return String(status || "").toUpperCase() === "APPROVED";
}

function isReleaseWorkflowStage(stageName) {
  const stageKey = normalizeWorkflowStageKey(stageName);
  return Boolean(stageKey && OUTSOURCE_COMPLETION_IGNORED_STAGE_KEYS.has(stageKey));
}

function sortWorkflowProgressRows(progressRows = []) {
  return (Array.isArray(progressRows) ? progressRows : [])
    .map((stage, index) => ({ stage, index }))
    .sort((leftEntry, rightEntry) => {
      const leftOrder = Number(leftEntry.stage?.stage_order);
      const rightOrder = Number(rightEntry.stage?.stage_order);
      if (Number.isFinite(leftOrder) && Number.isFinite(rightOrder) && leftOrder !== rightOrder) {
        return leftOrder - rightOrder;
      }
      if (Number.isFinite(leftOrder)) {
        return -1;
      }
      if (Number.isFinite(rightOrder)) {
        return 1;
      }
      return leftEntry.index - rightEntry.index;
    })
    .map((entry) => entry.stage);
}

function getCurrentDesignWorkflowStage(progressRows = []) {
  const sortedRows = sortWorkflowProgressRows(progressRows);
  return sortedRows.find((stage) => !isApprovedWorkflowStatus(stage?.status) && !isReleaseWorkflowStage(stage?.stage_name))
    || sortedRows.find((stage) => !isApprovedWorkflowStatus(stage?.status))
    || null;
}

function getNextDesignWorkflowStage(progressRows = [], currentStage = null) {
  if (!currentStage) {
    return null;
  }

  const sortedRows = sortWorkflowProgressRows(progressRows);
  const currentIndex = sortedRows.findIndex((stage) => stage === currentStage);
  const startIndex = currentIndex >= 0 ? currentIndex + 1 : 0;

  for (let index = startIndex; index < sortedRows.length; index += 1) {
    const stage = sortedRows[index];
    if (!isApprovedWorkflowStatus(stage?.status) && !isReleaseWorkflowStage(stage?.stage_name)) {
      return stage;
    }
  }

  for (let index = startIndex; index < sortedRows.length; index += 1) {
    const stage = sortedRows[index];
    if (!isApprovedWorkflowStatus(stage?.status)) {
      return stage;
    }
  }

  return null;
}

function resolveOutsourceStageCompletion(progressRows = [], outsourcedStages = []) {
  const sortedRows = sortWorkflowProgressRows(progressRows);
  const outsourcedStageKeys = getOutsourcedWorkflowStageKeys(outsourcedStages);
  const currentStage = getCurrentDesignWorkflowStage(sortedRows);

  if (!currentStage) {
    return {
      canComplete: false,
      reason: "No active workflow stage is available",
      currentStage: null,
      currentStageName: null,
      currentStageKey: null,
      currentStageIsOutsourced: false,
      stageNamesToApprove: [],
      nextStage: null,
      nextStageName: null,
      remainingOutsourcedStageNames: [],
      workflowMarkedComplete: false,
    };
  }

  const currentStageKey = normalizeWorkflowStageKey(currentStage.stage_name);
  const currentStageIsOutsourced = Boolean(currentStageKey && outsourcedStageKeys.has(currentStageKey));
  if (!currentStageIsOutsourced) {
    return {
      canComplete: false,
      reason: `Current workflow stage "${currentStage.stage_name || "Unknown"}" is not outsourced`,
      currentStage,
      currentStageName: currentStage.stage_name || null,
      currentStageKey,
      currentStageIsOutsourced: false,
      stageNamesToApprove: [],
      nextStage: null,
      nextStageName: null,
      remainingOutsourcedStageNames: sortedRows
        .filter((stage) => !isApprovedWorkflowStatus(stage?.status))
        .filter((stage) => {
          const stageKey = normalizeWorkflowStageKey(stage?.stage_name);
          return Boolean(stageKey && outsourcedStageKeys.has(stageKey));
        })
        .map((stage) => stage.stage_name)
        .filter(Boolean),
      workflowMarkedComplete: false,
    };
  }

  const rowsAfterCurrentCompletion = sortedRows.map((stage) => (
    stage === currentStage
      ? { ...stage, status: "APPROVED" }
      : stage
  ));
  const stageNamesToApprove = [currentStage.stage_name].filter(Boolean);
  const remainingOutsourcedStageNames = rowsAfterCurrentCompletion
    .filter((stage) => !isApprovedWorkflowStatus(stage?.status))
    .filter((stage) => {
      const stageKey = normalizeWorkflowStageKey(stage?.stage_name);
      return Boolean(stageKey && outsourcedStageKeys.has(stageKey));
    })
    .map((stage) => stage.stage_name)
    .filter(Boolean);
  const nextStage = getNextDesignWorkflowStage(rowsAfterCurrentCompletion, currentStage);

  return {
    canComplete: true,
    reason: null,
    currentStage,
    currentStageName: currentStage.stage_name || null,
    currentStageKey,
    currentStageIsOutsourced: true,
    stageNamesToApprove,
    nextStage,
    nextStageName: nextStage?.stage_name || null,
    remainingOutsourcedStageNames,
    workflowMarkedComplete: false,
  };
}

function getOutsourceCompletionAutoApproveStageNames(progressRows = [], outsourcedStages = []) {
  return resolveOutsourceStageCompletion(progressRows, outsourcedStages).stageNamesToApprove;
}

function canCompleteWorkflowAfterOutsource(progressRows = [], outsourcedStages = []) {
  const transition = resolveOutsourceStageCompletion(progressRows, outsourcedStages);
  return transition.canComplete && transition.workflowMarkedComplete;
}

module.exports = {
  ALLOWED_OUTSOURCE_STAGES,
  OUTSOURCE_STATUSES,
  canCompleteWorkflowAfterOutsource,
  canonicalizeOutsourceStage,
  getCurrentDesignWorkflowStage,
  getOutsourceCompletionAutoApproveStageNames,
  getOutsourcedWorkflowStageKeys,
  isApprovedWorkflowStatus,
  isOutsourcedWorkflowStage,
  isReleaseWorkflowStage,
  mergeRecentSupplierNames,
  normalizeOutsourceStages,
  normalizeWorkflowStageKey,
  normalizeOutsourceStatus,
  normalizeSupplierName,
  resolveOutsourceStageCompletion,
  sortWorkflowProgressRows,
};
