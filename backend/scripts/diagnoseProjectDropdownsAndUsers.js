const { loadBackendEnv } = require("../config/loadEnv");
loadBackendEnv({ mode: process.env.NODE_ENV });

const { pool } = require("../db");
const { getBatches } = require("../services/batchService");
const {
  listDesignProjectsForUser,
  listProjectDashboardForUser,
} = require("../services/projectCatalogService");
const { findUserByEmployeeId, listUsers } = require("../repositories/usersRepository");
const { trimmedTextSql, userIdentifierMatchSql } = require("../repositories/sqlFragments");

function parseArgs(argv) {
  const args = { employeeId: null, allUsers: false };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--employee-id" || arg === "--user") {
      args.employeeId = String(argv[index + 1] || "").trim() || null;
      index += 1;
    } else if (arg === "--all-users") {
      args.allUsers = true;
    }
  }

  return args;
}

function projectKey(project) {
  return String(project?.project_id || project?.id || "").trim();
}

function projectLabel(project) {
  return {
    project_id: projectKey(project),
    project_no: project.project_no || project.project_code || null,
    project_name: project.project_name || null,
    project_status: project.project_status || null,
    is_modified: project.is_modified === true,
    completion_percent: project.completion_percent ?? project.project_completion_percent ?? null,
    completion_strict_complete: project.completion_strict_complete === true,
    total_fixtures: Number(project.total_fixtures || project.total_tasks || 0),
    completed_fixtures: Number(project.completed_tasks || project.completed_fixtures || 0),
  };
}

function byProjectId(projects) {
  return new Map(projects.map((project) => [projectKey(project), project]).filter(([id]) => id));
}

function diffProjects(left, right) {
  const rightIds = new Set(right.map(projectKey));
  return left.filter((project) => !rightIds.has(projectKey(project))).map(projectLabel);
}

function activeSelectionExclusionReason(project) {
  const status = String(project?.project_status || "active").trim().toLowerCase();
  if (status !== "active") {
    return `project_status_${status || "blank"}`;
  }

  if (project?.is_modified === true) {
    return null;
  }

  const completionPercent = Number(project?.completion_percent ?? project?.project_completion_percent);
  if (Number.isFinite(completionPercent) && completionPercent >= 100) {
    return "completion_percent_gte_100";
  }

  if (project?.completion_strict_complete === true) {
    return "completion_strict_complete";
  }

  const totalFixtures = Number(project?.total_fixtures || project?.total_tasks || 0);
  const completedFixtures = Number(project?.completed_tasks || project?.completed_fixtures || 0);
  if (totalFixtures > 0 && completedFixtures >= totalFixtures) {
    return "completed_fixture_count_gte_total";
  }

  return "not_excluded_by_known_active_selection_filter";
}

async function loadUsers(args) {
  if (args.employeeId) {
    const user = await findUserByEmployeeId(args.employeeId);
    if (!user) {
      throw new Error(`No user found for employee id/email/id "${args.employeeId}"`);
    }
    return [user];
  }

  const users = await listUsers();
  return args.allUsers ? users : users.filter((user) => user.is_active !== false);
}

async function compareProjectSetsForUser(user) {
  const [dashboardDropdown, projectsTab, activeAssignmentDropdown] = await Promise.all([
    listProjectDashboardForUser(user, null),
    getBatches(user),
    listDesignProjectsForUser(user, null, { activeOnly: true }),
  ]);

  const dashboardById = byProjectId(dashboardDropdown);
  const activeById = byProjectId(activeAssignmentDropdown);

  const projectsOnlyInTab = diffProjects(projectsTab, dashboardDropdown);
  const projectsOnlyInDashboardDropdown = diffProjects(dashboardDropdown, projectsTab);
  const projectsOnlyInProjectsTabVsActiveAssignment = diffProjects(projectsTab, activeAssignmentDropdown)
    .map((project) => {
      const dashboardProject = dashboardById.get(project.project_id);
      return {
        ...project,
        exclusion_filter: dashboardProject
          ? activeSelectionExclusionReason(dashboardProject)
          : "not_returned_by_dashboard_summary_visibility_query",
      };
    });
  const projectsOnlyInActiveAssignment = diffProjects(activeAssignmentDropdown, projectsTab);

  return {
    employee_id: user.employee_id,
    name: user.name,
    counts: {
      project_fixture_dropdown: dashboardDropdown.length,
      projects_tab: projectsTab.length,
      active_assignment_dropdown: activeAssignmentDropdown.length,
    },
    project_fixture_dropdown_vs_projects_tab: {
      only_in_project_fixture_dropdown: projectsOnlyInDashboardDropdown,
      only_in_projects_tab: projectsOnlyInTab,
    },
    active_assignment_dropdown_vs_projects_tab: {
      only_in_active_assignment_dropdown: projectsOnlyInActiveAssignment,
      only_in_projects_tab: projectsOnlyInProjectsTabVsActiveAssignment,
    },
    active_assignment_ids: [...activeById.keys()].sort(),
  };
}

async function loadUserReferenceDiagnostics() {
  const identifier = trimmedTextSql("ref.identifier");

  const result = await pool.query(`
    WITH user_refs AS (
      SELECT 'design.projects.created_by_user_id' AS source, p.id::text AS entity_id, p.project_no AS context, p.created_by_user_id::text AS identifier FROM design.projects p
      UNION ALL SELECT 'design.projects.uploaded_by', p.id::text, p.project_no, p.uploaded_by::text FROM design.projects p
      UNION ALL SELECT 'design.projects.project_leader_id', p.id::text, p.project_no, p.project_leader_id::text FROM design.projects p
      UNION ALL SELECT 'design.projects.team_lead_id', p.id::text, p.project_no, p.team_lead_id::text FROM design.projects p
      UNION ALL SELECT 'design.upload_batches.uploaded_by_user_id', ub.id::text, p.project_no, ub.uploaded_by_user_id::text FROM design.upload_batches ub LEFT JOIN design.projects p ON p.id = ub.project_id
      UNION ALL SELECT 'design.upload_batches.uploaded_by', ub.id::text, p.project_no, ub.uploaded_by::text FROM design.upload_batches ub LEFT JOIN design.projects p ON p.id = ub.project_id
      UNION ALL SELECT 'fixture_workflow_progress.assigned_to', fwp.fixture_id::text, fwp.stage_name, fwp.assigned_to::text FROM fixture_workflow_progress fwp
      UNION ALL SELECT 'fixture_workflow_stage_attempts.assigned_to', attempts.fixture_id::text, attempts.stage_name, attempts.assigned_to::text FROM fixture_workflow_stage_attempts attempts
      UNION ALL SELECT 'tasks.assigned_to', t.id::text, t.title, t.assigned_to::text FROM tasks t
      UNION ALL SELECT 'tasks.assigned_user_id', t.id::text, t.title, t.assigned_user_id::text FROM tasks t
      UNION ALL SELECT 'tasks.assigned_by', t.id::text, t.title, t.assigned_by::text FROM tasks t
      UNION ALL SELECT 'tasks.created_by', t.id::text, t.title, t.created_by::text FROM tasks t
      UNION ALL SELECT 'tasks.approved_by', t.id::text, t.title, t.approved_by::text FROM tasks t
      UNION ALL SELECT 'task_attachments.uploaded_by', ta.id::text, ta.file_name, ta.uploaded_by::text FROM task_attachments ta
      UNION ALL SELECT 'task_activity_logs.user_employee_id', tal.id::text, tal.action_type, tal.user_employee_id::text FROM task_activity_logs tal
      UNION ALL SELECT 'task_logs.updated_by', tl.id::text, tl.action, tl.updated_by::text FROM task_logs tl
      UNION ALL SELECT 'task_logs.user_employee_id', tl.id::text, tl.action, tl.user_employee_id::text FROM task_logs tl
      UNION ALL SELECT 'design.fixture_stage_contributions.employee_id', c.id::text, c.stage_name, c.employee_id::text FROM design.fixture_stage_contributions c
      UNION ALL SELECT 'design.fixture_stage_contributions.transferred_by', c.id::text, c.stage_name, c.transferred_by::text FROM design.fixture_stage_contributions c
      UNION ALL SELECT 'design.fixture_stage_contributions.changed_by', c.id::text, c.stage_name, c.changed_by::text FROM design.fixture_stage_contributions c
      UNION ALL SELECT 'fixture_workflow_revisions.requested_by', r.id::text, r.stage_name, r.requested_by::text FROM fixture_workflow_revisions r
      UNION ALL SELECT 'fixture_workflow_revisions.approved_by', r.id::text, r.stage_name, r.approved_by::text FROM fixture_workflow_revisions r
      UNION ALL SELECT 'fixture_workflow_revisions.changed_by', r.id::text, r.stage_name, r.changed_by::text FROM fixture_workflow_revisions r
      UNION ALL SELECT 'audit_logs.user_employee_id', a.id::text, a.action_type, a.user_employee_id::text FROM audit_logs a
      UNION ALL SELECT 'design.project_subdivision_assignments.assigned_leader_id', psa.id::text, psa.project_id::text, psa.assigned_leader_id::text FROM design.project_subdivision_assignments psa
      UNION ALL SELECT 'design.project_subdivision_assignments.assigned_by', psa.id::text, psa.project_id::text, psa.assigned_by::text FROM design.project_subdivision_assignments psa
    )
    SELECT
      ref.source,
      ref.entity_id,
      ref.context,
      ref.identifier,
      resolved.employee_id AS resolved_employee_id,
      resolved.name AS resolved_name,
      resolved.is_active AS resolved_is_active,
      CASE
        WHEN ${identifier} IS NULL THEN 'blank_identifier'
        WHEN exact_employee.employee_id IS NOT NULL THEN 'employee_id'
        WHEN uuid_user.employee_id IS NOT NULL THEN 'user_uuid_wrong_key'
        WHEN email_user.employee_id IS NOT NULL THEN 'email_identifier'
        WHEN numeric_user.employee_id IS NOT NULL THEN 'numeric_text_mismatch'
        ELSE NULL
      END AS resolution_method,
      CASE
        WHEN ${identifier} IS NULL THEN 'blank_identifier'
        WHEN resolved.employee_id IS NULL AND ${identifier} ~* '^[0-9a-f-]{32,36}$' THEN 'stale_or_deleted_user_uuid'
        WHEN resolved.employee_id IS NULL THEN 'no_matching_users_record_for_identifier'
        WHEN resolved.is_active IS FALSE THEN 'resolved_inactive_user_was_previously_at_risk'
        WHEN exact_employee.employee_id IS NULL THEN 'resolved_by_fallback_lookup'
        ELSE NULL
      END AS root_cause
    FROM user_refs ref
    LEFT JOIN users resolved
      ON ${userIdentifierMatchSql("resolved", "ref.identifier")}
    LEFT JOIN users exact_employee
      ON exact_employee.employee_id = ${identifier}
    LEFT JOIN users uuid_user
      ON uuid_user.id::text = ${identifier}
    LEFT JOIN users email_user
      ON LOWER(email_user.email) = LOWER(${identifier})
    LEFT JOIN users numeric_user
      ON numeric_user.employee_id ~ '^[0-9]+$'
     AND ${identifier} ~ '^[0-9]+$'
     AND NULLIF(REGEXP_REPLACE(numeric_user.employee_id, '^0+', ''), '') = NULLIF(REGEXP_REPLACE(${identifier}, '^0+', ''), '')
    WHERE ${identifier} IS NOT NULL
      AND (
        resolved.employee_id IS NULL
        OR exact_employee.employee_id IS NULL
        OR resolved.is_active IS FALSE
      )
    ORDER BY ref.source ASC, ref.context ASC NULLS LAST, ref.entity_id ASC
  `);

  return {
    unresolved: result.rows.filter((row) => !row.resolved_employee_id),
    resolved_by_fallback: result.rows.filter((row) => row.resolved_employee_id && row.resolution_method !== "employee_id"),
    resolved_inactive: result.rows.filter((row) => row.resolved_employee_id && row.resolved_is_active === false),
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const users = await loadUsers(args);
  const comparisons = [];

  for (const user of users) {
    comparisons.push(await compareProjectSetsForUser(user));
  }

  const user_reference_diagnostics = await loadUserReferenceDiagnostics();

  console.log(JSON.stringify({
    generated_at: new Date().toISOString(),
    compared_users: comparisons.length,
    comparisons,
    user_reference_diagnostics,
  }, null, 2));
}

main()
  .catch((error) => {
    console.error(error.stack || error.message || String(error));
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end().catch(() => {});
  });
