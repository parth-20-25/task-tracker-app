const { pool } = require("../../db");
const { createAuditLog } = require("../../repositories/auditRepository");
const {
  loadFixtureBundlesForProject,
} = require("../../repositories/designCompletionRepository");
const { getConfiguredWorkflowForDepartment } = require("../../repositories/fixtureWorkflowRepository");
const { normalizeDesignStageName } = require("../../lib/designWorkflowStages");

function normalizeStatus(value) {
  return String(value || "").trim().toUpperCase();
}

function evidenceStatusFromTask(task) {
  const status = String(task?.status || "").trim().toLowerCase();
  if (task?.approved_at || task?.closed_at || status === "closed") {
    return "APPROVED";
  }
  if (task?.submitted_at || ["under_review", "submitted_for_verification"].includes(status)) {
    return "SUBMITTED_FOR_VERIFICATION";
  }
  if (status === "rework") {
    return "REJECTED";
  }
  if (status === "in_progress") {
    return "IN_PROGRESS";
  }
  if (status === "assigned") {
    return "PENDING";
  }
  return null;
}

function resolveBackfillCandidate(bundle, workflowStage) {
  const stageKey = normalizeDesignStageName(workflowStage.name || workflowStage.stage_name);
  const stageName = workflowStage.name || workflowStage.stage_name;
  const existing = (bundle.progress_rows || []).find(
    (row) => normalizeDesignStageName(row.stage_name) === stageKey,
  );
  if (existing) {
    return { action: "existing", stage_key: stageKey, stage_name: stageName };
  }

  const attempts = (bundle.stage_attempt_rows || []).filter(
    (row) => normalizeDesignStageName(row.stage_name) === stageKey,
  );
  const tasks = (bundle.task_rows || []).filter(
    (row) => normalizeDesignStageName(row.stage_name) === stageKey,
  );
  const revisions = (bundle.revision_rows || []).filter(
    (row) => normalizeDesignStageName(row.stage_name) === stageKey,
  );
  const transitions = (bundle.transition_rows || []).filter(
    (row) => normalizeDesignStageName(row.stage_name) === stageKey,
  );
  const outsourcing = (bundle.outsource_rows || []).filter(
    (row) => normalizeDesignStageName(row.stage_name) === stageKey,
  );
  const statuses = [];

  attempts.forEach((row) => {
    const status = normalizeStatus(row.status);
    if (["IN_PROGRESS", "COMPLETED", "APPROVED", "REJECTED"].includes(status)) {
      statuses.push(status === "COMPLETED" ? "SUBMITTED_FOR_VERIFICATION" : status);
    }
  });
  tasks.forEach((row) => {
    const status = evidenceStatusFromTask(row);
    if (status) {
      statuses.push(status);
    }
  });
  transitions.forEach((row) => {
    const action = String(row.action_type || "").toLowerCase();
    if (action.includes("approved")) {
      statuses.push("APPROVED");
    } else if (action.includes("rework")) {
      statuses.push("REJECTED");
    }
  });
  revisions.forEach(() => statuses.push("PENDING"));
  outsourcing.forEach((row) => {
    statuses.push(row.outsource_status === "completed" ? "APPROVED" : "PENDING");
  });

  if (bundle.is_workflow_complete === true) {
    statuses.push("APPROVED");
  }

  const uniqueStatuses = [...new Set(statuses)];
  if (uniqueStatuses.length === 0) {
    return {
      action: "unresolved",
      stage_key: stageKey,
      stage_name: stageName,
      reason: `no_real_evidence:${stageKey}`,
    };
  }

  const terminalStatuses = uniqueStatuses.filter((status) => ["APPROVED", "REJECTED"].includes(status));
  if (terminalStatuses.length > 1) {
    return {
      action: "unresolved",
      stage_key: stageKey,
      stage_name: stageName,
      reason: `conflicting_terminal_evidence:${stageKey}:${terminalStatuses.join(",")}`,
    };
  }

  const statusPriority = ["APPROVED", "REJECTED", "SUBMITTED_FOR_VERIFICATION", "IN_PROGRESS", "PENDING"];
  const status = statusPriority.find((candidate) => uniqueStatuses.includes(candidate));
  const latestAttempt = attempts[attempts.length - 1] || null;
  const latestTask = tasks[tasks.length - 1] || null;

  return {
    action: "insert",
    stage_key: stageKey,
    stage_name: stageName,
    stage_order: Number(workflowStage.order || workflowStage.sequence_order || 0),
    status,
    stage_version: Number(latestAttempt?.stage_version || revisions[revisions.length - 1]?.stage_version || 0),
    assigned_to: latestAttempt?.assigned_to || latestTask?.assigned_to || null,
    assigned_at: latestAttempt?.assigned_at || null,
    started_at: latestAttempt?.started_at || null,
    completed_at: latestAttempt?.approved_at
      || latestAttempt?.completed_at
      || latestTask?.approved_at
      || latestTask?.closed_at
      || null,
    duration_minutes: latestAttempt?.duration_minutes || null,
    evidence: {
      attempts: attempts.map((row) => row.id || `${row.stage_name}:${row.attempt_no}`),
      tasks: tasks.map((row) => row.task_id),
      revisions: revisions.map((row) => row.id),
      transitions: transitions.map((row) => row.id),
      outsourcing: outsourcing.map((row) => row.id),
      workflow_complete: bundle.is_workflow_complete === true,
    },
  };
}

async function diagnoseAndBackfillWorkflowProgress({
  apply = false,
  actorEmployeeId = "system-progress-backfill",
  projectId = null,
} = {}) {
  const projectResult = await pool.query(
    `
      SELECT id AS project_id, project_no, department_id
      FROM design.projects
      WHERE ($1::uuid IS NULL OR id = $1)
      ORDER BY project_no ASC, id ASC
    `,
    [projectId],
  );
  const summary = {
    mode: apply ? "apply" : "diagnostic",
    projects_scanned: projectResult.rowCount,
    fixtures_scanned: 0,
    inserted: [],
    unresolved: [],
  };

  for (const project of projectResult.rows) {
    const [workflow, bundles] = await Promise.all([
      getConfiguredWorkflowForDepartment(project.department_id),
      loadFixtureBundlesForProject(project.project_id, project.department_id),
    ]);
    const stages = workflow?.stages || [];

    for (const bundle of bundles) {
      summary.fixtures_scanned += 1;
      const candidates = stages.map((stage) => resolveBackfillCandidate(bundle, stage));
      const inserts = candidates.filter((candidate) => candidate.action === "insert");
      const unresolved = candidates.filter((candidate) => candidate.action === "unresolved");

      summary.unresolved.push(...unresolved.map((candidate) => ({
        project_id: project.project_id,
        project_no: project.project_no,
        fixture_id: bundle.fixture_id,
        fixture_no: bundle.fixture_no,
        stage: candidate.stage_name,
        reason: candidate.reason,
      })));

      if (!apply || inserts.length === 0) {
        summary.inserted.push(...inserts.map((candidate) => ({
          project_id: project.project_id,
          project_no: project.project_no,
          fixture_id: bundle.fixture_id,
          fixture_no: bundle.fixture_no,
          ...candidate,
          applied: false,
        })));
        continue;
      }

      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        for (const candidate of inserts) {
          const inserted = await client.query(
            `
              INSERT INTO fixture_workflow_progress (
                fixture_id, department_id, stage_name, stage_order, stage_version,
                status, assigned_to, assigned_at, started_at, completed_at, duration_minutes
              )
              VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
              ON CONFLICT (fixture_id, stage_name) DO NOTHING
              RETURNING id
            `,
            [
              bundle.fixture_id,
              project.department_id,
              candidate.stage_name,
              candidate.stage_order,
              candidate.stage_version,
              candidate.status,
              candidate.assigned_to,
              candidate.assigned_at,
              candidate.started_at,
              candidate.completed_at,
              candidate.duration_minutes,
            ],
          );
          if (inserted.rowCount > 0) {
            await createAuditLog({
              userEmployeeId: actorEmployeeId,
              actionType: "WORKFLOW_PROGRESS_BACKFILLED",
              targetType: "design_fixture",
              targetId: bundle.fixture_id,
              metadata: {
                project_id: project.project_id,
                fixture_no: bundle.fixture_no,
                progress_row_id: inserted.rows[0].id,
                stage_name: candidate.stage_name,
                stage_order: candidate.stage_order,
                reconstructed_status: candidate.status,
                evidence: candidate.evidence,
              },
            }, client);
          }
          summary.inserted.push({
            project_id: project.project_id,
            project_no: project.project_no,
            fixture_id: bundle.fixture_id,
            fixture_no: bundle.fixture_no,
            ...candidate,
            applied: inserted.rowCount > 0,
          });
        }

        if (unresolved.length > 0) {
          await createAuditLog({
            userEmployeeId: actorEmployeeId,
            actionType: "WORKFLOW_PROGRESS_BACKFILL_UNRESOLVED",
            targetType: "design_fixture",
            targetId: bundle.fixture_id,
            metadata: {
              project_id: project.project_id,
              fixture_no: bundle.fixture_no,
              reasons: unresolved.map((candidate) => candidate.reason),
            },
          }, client);
        }
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    }
  }

  return summary;
}

module.exports = {
  diagnoseAndBackfillWorkflowProgress,
  evidenceStatusFromTask,
  resolveBackfillCandidate,
};
