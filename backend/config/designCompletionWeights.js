/**
 * Default Design stage weights (percent of fixture completion).
 * Must sum to 100 across the canonical stage keys present in a workflow.
 * Department-specific overrides live in design.stage_completion_weights.
 */
const DEFAULT_DESIGN_STAGE_WEIGHTS = Object.freeze({
  concept: 15,
  dap: 20,
  "3d_finish": 25,
  "2d_finish": 25,
  release: 15,
  detailing: 0,
});

const COMPLETION_TRUTH_STATUSES = Object.freeze({
  COMPLETE: "complete",
  INCOMPLETE_TRUTH: "incomplete_truth",
  DEGRADED: "degraded",
});

module.exports = {
  COMPLETION_TRUTH_STATUSES,
  DEFAULT_DESIGN_STAGE_WEIGHTS,
};
