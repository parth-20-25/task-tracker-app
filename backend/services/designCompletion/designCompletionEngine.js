const { instrumentModuleExports } = require("../../lib/observability");
const {
  loadFixtureBundlesForProject,
  loadFixtureBundleById,
  loadProjectBundlesForProjects,
  loadStageWeightRowsForDepartment,
  insertCompletionSnapshot,
} = require("../../repositories/designCompletionRepository");
const { getConfiguredWorkflowForDepartment } = require("../../repositories/fixtureWorkflowRepository");
const { computeFixtureCompletionTruth } = require("./fixtureCompletionCalculator");
const { aggregateProjectCompletionTruth } = require("./projectCompletionAggregator");

async function buildProjectBundle(projectMeta, client) {
  const departmentId = projectMeta.department_id;
  const [fixtureBundles, weightRows, workflow] = await Promise.all([
    loadFixtureBundlesForProject(projectMeta.project_id, departmentId, client),
    loadStageWeightRowsForDepartment(departmentId, client),
    getConfiguredWorkflowForDepartment(departmentId, client),
  ]);

  const workflowStages = workflow?.stages || [];

  return {
    project_id: projectMeta.project_id,
    project_no: projectMeta.project_no,
    department_id: departmentId,
    project_status: projectMeta.project_status,
    fixture_bundles: fixtureBundles.map((bundle) => ({
      ...bundle,
      workflow_stages: workflowStages,
      weight_rows: weightRows,
      project_status: projectMeta.project_status,
    })),
  };
}

async function getFixtureCompletionTruth(fixtureId, departmentId, client) {
  const bundle = await loadFixtureBundleById(fixtureId, departmentId, client);
  if (!bundle) {
    return null;
  }

  const [weightRows, workflow] = await Promise.all([
    loadStageWeightRowsForDepartment(departmentId, client),
    getConfiguredWorkflowForDepartment(departmentId, client),
  ]);

  return computeFixtureCompletionTruth({
    ...bundle,
    workflow_stages: workflow?.stages || [],
    weight_rows: weightRows,
  });
}

async function getProjectCompletionTruth(projectMeta, client) {
  const bundle = await buildProjectBundle(projectMeta, client);
  return aggregateProjectCompletionTruth(bundle);
}

async function getProjectCompletionTruthById(projectId, departmentId, client) {
  const bundles = await loadProjectBundlesForProjects([{ project_id: projectId, department_id: departmentId }], client);
  const projectMeta = bundles[0];
  if (!projectMeta) {
    return null;
  }
  return getProjectCompletionTruth(projectMeta, client);
}

async function enrichProjectSummariesWithCompletionTruth(summaries = [], client) {
  if (!Array.isArray(summaries) || summaries.length === 0) {
    return summaries;
  }

  const projectMetas = summaries.map((row) => ({
    project_id: row.project_id,
    project_no: row.project_no,
    department_id: row.department_id,
    project_status: row.project_status,
  }));

  const bundles = await loadProjectBundlesForProjects(projectMetas, client);
  const bundleByProjectId = new Map(bundles.map((bundle) => [bundle.project_id, bundle]));

  const departmentIds = [...new Set(bundles.map((bundle) => bundle.department_id).filter(Boolean))];
  const weightsByDepartment = new Map();
  const workflowByDepartment = new Map();

  await Promise.all(departmentIds.map(async (departmentId) => {
    const [weightRows, workflow] = await Promise.all([
      loadStageWeightRowsForDepartment(departmentId, client),
      getConfiguredWorkflowForDepartment(departmentId, client),
    ]);
    weightsByDepartment.set(departmentId, weightRows);
    workflowByDepartment.set(departmentId, workflow?.stages || []);
  }));

  return summaries.map((summary) => {
    const bundle = bundleByProjectId.get(summary.project_id);
    if (!bundle) {
      return {
        ...summary,
        completion_percent: null,
        completion_truth_status: "incomplete_truth",
        completion_strict_complete: false,
      };
    }

    const projectTruth = aggregateProjectCompletionTruth({
      ...bundle,
      fixture_bundles: bundle.fixture_bundles.map((fixtureBundle) => ({
        ...fixtureBundle,
        workflow_stages: workflowByDepartment.get(bundle.department_id) || [],
        weight_rows: weightsByDepartment.get(bundle.department_id) || [],
        project_status: bundle.project_status,
      })),
    });

    return {
      ...summary,
      completion_percent: projectTruth.completion_percent,
      completion_truth_status: projectTruth.truth_status,
      completion_strict_complete: projectTruth.strict_complete,
      completion_truth_errors: projectTruth.truth_errors,
    };
  });
}

async function recordFixtureCompletionSnapshot(fixtureTruth, trigger = "manual", client) {
  if (!fixtureTruth?.fixture_id) {
    return null;
  }

  return insertCompletionSnapshot({
    fixture_id: fixtureTruth.fixture_id,
    project_id: fixtureTruth.project_id,
    scope: "fixture",
    trigger,
    payload: fixtureTruth,
  }, client);
}

module.exports = instrumentModuleExports("service.designCompletionEngine", {
  buildProjectBundle,
  computeFixtureCompletionTruth,
  aggregateProjectCompletionTruth,
  enrichProjectSummariesWithCompletionTruth,
  getFixtureCompletionTruth,
  getProjectCompletionTruth,
  getProjectCompletionTruthById,
  recordFixtureCompletionSnapshot,
});
