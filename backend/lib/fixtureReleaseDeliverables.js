const { normalizeDesignStageName } = require("./designWorkflowStages");

const RELEASE_PACKAGE_STATUSES = Object.freeze({
  IN_PROGRESS: "IN_PROGRESS",
  READY_FOR_RELEASE: "READY_FOR_RELEASE",
});

const RELEASE_DELIVERABLE_STATUSES = Object.freeze({
  LOCKED: "LOCKED",
  READY: "READY",
  IN_PROGRESS: "IN_PROGRESS",
  PENDING_APPROVAL: "PENDING_APPROVAL",
  CHANGES_REQUIRED: "CHANGES_REQUIRED",
  APPROVED: "APPROVED",
  NOT_APPLICABLE: "NOT_APPLICABLE",
});

const RELEASE_DELIVERABLE_APPLICABILITY = Object.freeze({
  REQUIRED: "REQUIRED",
  UNRESOLVED: "UNRESOLVED",
  NOT_APPLICABLE: "NOT_APPLICABLE",
});

const RELEASE_DELIVERABLE_CODES = Object.freeze({
  DRAFTING: "DRAFTING",
  PRINT_DRAFTING_CHECKING: "PRINT_DRAFTING_CHECKING",
  BOM_CHECKING: "BOM_CHECKING",
  DRAWING_CORRECTION: "DRAWING_CORRECTION",
  AUTOCAD_PDF: "AUTOCAD_PDF",
  IGES_DATA: "IGES_DATA",
  CMM_DATA: "CMM_DATA",
  LINE_LAYOUT: "LINE_LAYOUT",
  MIMIC_DISPLAY: "MIMIC_DISPLAY",
  WEAR_OUT_DATA: "WEAR_OUT_DATA",
});

const RELEASE_DELIVERABLE_DEFINITIONS = Object.freeze([
  { code: RELEASE_DELIVERABLE_CODES.DRAFTING, label: "Drafting", sequence: 1, isRequired: true },
  { code: RELEASE_DELIVERABLE_CODES.PRINT_DRAFTING_CHECKING, label: "Print & Drafting Checking", sequence: 2, isRequired: true },
  { code: RELEASE_DELIVERABLE_CODES.BOM_CHECKING, label: "BOM Checking", sequence: 3, isRequired: true },
  { code: RELEASE_DELIVERABLE_CODES.DRAWING_CORRECTION, label: "Drawing Correction", sequence: 4, isRequired: true },
  { code: RELEASE_DELIVERABLE_CODES.AUTOCAD_PDF, label: "AutoCAD PDF", sequence: 5, isRequired: true },
  { code: RELEASE_DELIVERABLE_CODES.IGES_DATA, label: "IGES Data", sequence: 6, isRequired: true },
  { code: RELEASE_DELIVERABLE_CODES.CMM_DATA, label: "CMM Data", sequence: 7, isRequired: true },
  { code: RELEASE_DELIVERABLE_CODES.LINE_LAYOUT, label: "Line Layout", sequence: 8, isRequired: true },
  { code: RELEASE_DELIVERABLE_CODES.MIMIC_DISPLAY, label: "Mimic Display", sequence: 9, isRequired: false },
  { code: RELEASE_DELIVERABLE_CODES.WEAR_OUT_DATA, label: "Wear-Out Data", sequence: 10, isRequired: true },
]);

const RELEASE_DELIVERABLE_BY_CODE = new Map(
  RELEASE_DELIVERABLE_DEFINITIONS.map((definition) => [definition.code, definition]),
);

function normalizeReleaseDeliverableCode(value) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function getReleaseDeliverableDefinition(value) {
  return RELEASE_DELIVERABLE_BY_CODE.get(normalizeReleaseDeliverableCode(value)) || null;
}

function isReleaseStageName(value) {
  return normalizeDesignStageName(value) === "release";
}

function isResolvedDeliverable(deliverable) {
  return deliverable?.status === RELEASE_DELIVERABLE_STATUSES.APPROVED
    || (
      deliverable?.deliverable_code === RELEASE_DELIVERABLE_CODES.MIMIC_DISPLAY
      && deliverable?.applicability_status === RELEASE_DELIVERABLE_APPLICABILITY.NOT_APPLICABLE
      && deliverable?.status === RELEASE_DELIVERABLE_STATUSES.NOT_APPLICABLE
    );
}

function deliverableBlocker(deliverable, definition) {
  const status = deliverable?.status || "MISSING";
  const base = {
    deliverable: definition.code,
    message: `${definition.label} is incomplete`,
  };

  if (!deliverable) {
    return { ...base, code: "DELIVERABLE_MISSING", message: `${definition.label} is missing` };
  }
  if (
    definition.code === RELEASE_DELIVERABLE_CODES.MIMIC_DISPLAY
    && deliverable.applicability_status === RELEASE_DELIVERABLE_APPLICABILITY.UNRESOLVED
  ) {
    return { ...base, code: "MIMIC_APPLICABILITY_UNRESOLVED", message: "Mimic Display must be marked Required or Not Applicable" };
  }
  if (status === RELEASE_DELIVERABLE_STATUSES.PENDING_APPROVAL) {
    return { ...base, code: "DELIVERABLE_PENDING_APPROVAL", message: `${definition.label} is pending approval` };
  }
  if (status === RELEASE_DELIVERABLE_STATUSES.CHANGES_REQUIRED) {
    return { ...base, code: "DELIVERABLE_CHANGES_REQUIRED", message: `${definition.label} requires changes` };
  }
  return { ...base, code: "DELIVERABLE_INCOMPLETE" };
}

function buildFixtureReleaseBlockers(progressRows = [], releasePackage = null) {
  const blockers = [];
  const releaseStage = progressRows.find((stage) => isReleaseStageName(stage.stage_name));
  const mainStages = progressRows.filter((stage) => !isReleaseStageName(stage.stage_name));

  if (!releaseStage) {
    blockers.push({
      code: "RELEASE_STAGE_MISSING",
      message: "Release stage is not configured for this fixture workflow",
    });
  }

  if (mainStages.length === 0) {
    blockers.push({
      code: "MAIN_WORKFLOW_INCOMPLETE",
      message: "The main fixture workflow has no completed design stages",
    });
  } else {
    mainStages
      .filter((stage) => stage.status !== "APPROVED")
      .forEach((stage) => blockers.push({
        code: "MAIN_WORKFLOW_INCOMPLETE",
        stage: stage.stage_name,
        message: `${stage.stage_name || "Workflow stage"} is not approved`,
      }));
  }

  if (!releasePackage) {
    blockers.push({
      code: "RELEASE_PACKAGE_MISSING",
      message: "The 2D release-deliverables package has not been created",
    });
    return blockers;
  }

  const deliverables = Array.isArray(releasePackage.deliverables) ? releasePackage.deliverables : [];
  const byCode = new Map(deliverables.map((deliverable) => [deliverable.deliverable_code, deliverable]));

  for (const definition of RELEASE_DELIVERABLE_DEFINITIONS) {
    const deliverable = byCode.get(definition.code);
    if (!isResolvedDeliverable(deliverable)) {
      blockers.push(deliverableBlocker(deliverable, definition));
    }
  }

  return blockers;
}

module.exports = {
  RELEASE_DELIVERABLE_APPLICABILITY,
  RELEASE_DELIVERABLE_CODES,
  RELEASE_DELIVERABLE_DEFINITIONS,
  RELEASE_DELIVERABLE_STATUSES,
  RELEASE_PACKAGE_STATUSES,
  buildFixtureReleaseBlockers,
  getReleaseDeliverableDefinition,
  isReleaseStageName,
  isResolvedDeliverable,
  normalizeReleaseDeliverableCode,
};
