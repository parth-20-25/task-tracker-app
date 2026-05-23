const { pool } = require("../db");
const {
  GetAccessibleUserIds,
  buildVisibleUsersCte,
  getAccessibleProjectIds,
  isProjectAuthorityRoleIdentity,
  isProjectAuthorityRoleLevel,
  normalizeRoleKey,
  projectAuthoritySqlPredicate,
  visibleFixturePredicate,
  visibleProjectPredicate,
} = require("../repositories/projectVisibility");
function getRoleDetails(user) {
  if (user?.role && typeof user.role === "object") {
    return user.role;
  }

  if (user?.role_details && typeof user.role_details === "object") {
    return user.role_details;
  }

  return null;
}

function getRoleId(user) {
  if (!user) {
    return null;
  }

  if (typeof user.role === "string") {
    return user.role;
  }

  return user.role?.id || user.role_details?.id || user.role_id || null;
}

function getRoleLevel(user) {
  const roleDetails = getRoleDetails(user);
  const roleId = getRoleId(user);
  const { ROLE_LEVELS } = require("../config/constants");
  return roleDetails?.hierarchy_level ?? ROLE_LEVELS[roleId] ?? null;
}

const VISIBILITY_REASONS = {
  ORG_WIDE_AUTHORITY: "org_wide_authority",
  DESCENDANT_UPLOADER: "descendant_uploader",
  ASSIGNED_WORKFLOW: "assigned_workflow",
  DENIED: "denied",
};

function hasOrgWideVisibility(user) {
  const roleDetails = getRoleDetails(user);

  // Org-wide visibility is identity-based only (ADMIN/CEO/DIRECTOR).
  return isProjectAuthorityRoleIdentity(roleDetails?.name)
    || isProjectAuthorityRoleIdentity(getRoleId(user));
}

function getVisibilityContext(user) {
  const roleDetails = getRoleDetails(user);
  const orgWide = hasOrgWideVisibility(user);

  return {
    employee_id: user?.employee_id || null,
    department_id: user?.department_id || null,
    role_id: getRoleId(user),
    role_name: roleDetails?.name || null,
    hierarchy_level: getRoleLevel(user),
    org_wide_visibility: orgWide,
    visible_user_ids: Array.isArray(user?.visible_user_ids)
      ? user.visible_user_ids.filter(Boolean)
      : [],
  };
}

function projectOwnershipMatchSql(projectAlias = "p", cteName = "visible_users") {
  // Canonical ownership: project creator/uploader in the visible hierarchy.
  return `
    (
      COALESCE(${projectAlias}.created_by_user_id IN (SELECT employee_id FROM ${cteName}), FALSE)
      OR COALESCE(${projectAlias}.uploaded_by IN (SELECT employee_id FROM ${cteName}), FALSE)
    )
  `;
}

function projectAssignmentMatchSql(projectAlias = "p", cteName = "visible_users") {
  return `
    EXISTS (
      SELECT 1
      FROM design.fixtures visible_fixture
      JOIN fixture_workflow_progress visible_progress
        ON visible_progress.fixture_id = visible_fixture.id
      WHERE visible_fixture.project_id = ${projectAlias}.id
        AND visible_progress.assigned_to IN (SELECT employee_id FROM ${cteName})
      LIMIT 1
    )
  `;
}

function buildAuthoritativeProjectVisibilityPredicate(projectAlias = "p", cteName = "visible_users") {
  return `
    (
      EXISTS (
        SELECT 1
        FROM root_user root
        WHERE ${projectAuthoritySqlPredicate("root")}
      )
      OR (${projectOwnershipMatchSql(projectAlias, cteName)})
      OR (${projectAssignmentMatchSql(projectAlias, cteName)})
    )
  `;
}

function buildAuthoritativeFixtureVisibilityPredicate(
  fixtureAlias = "f",
  projectAlias = "p",
  cteName = "visible_users",
) {
  return buildAuthoritativeProjectVisibilityPredicate(projectAlias, cteName);
}

async function resolveAccessibleUserIds(user, client = pool) {
  const employeeId = user?.employee_id;
  if (!employeeId) {
    return [];
  }

  // Base visible users are self + descendants. The repository CTE also grants
  // Co-Leaders the full parent Team Leader operational tree.
  const accessible = await GetAccessibleUserIds(employeeId, client);
  const mergedVisibleUsers = new Set(accessible.filter(Boolean));

  if (Array.isArray(user?.visible_user_ids)) {
    user.visible_user_ids.filter(Boolean).forEach((visibleUserId) => {
      mergedVisibleUsers.add(visibleUserId);
    });
  }

  mergedVisibleUsers.add(employeeId);

  // Legacy fallback for stale deployments where the SQL CTE has not been
  // refreshed yet: add the parent Team Leader and their descendants.
  try {
    const roleKey = normalizeRoleKey(user?.role_details?.name || user?.role || user?.role_id);
    if (["co_leader", "team_co_leader", "shift_incharge"].includes(roleKey)) {
      const parentRes = await client.query(
        `
          SELECT parent.employee_id, parent.role AS role_id, r.name AS role_name
          FROM users child
          LEFT JOIN users parent ON parent.employee_id = child.parent_id OR parent.id::text = child.parent_id
          LEFT JOIN roles r ON r.id = parent.role
          WHERE child.employee_id = $1
          LIMIT 1
        `,
        [employeeId],
      );

      const parentRow = parentRes.rows[0];
      if (parentRow && parentRow.employee_id) {
        const parentRoleKey = normalizeRoleKey(parentRow.role_name || parentRow.role_id);
        if (["team_leader", "line_manager"].includes(parentRoleKey)) {
          const parentVisible = await GetAccessibleUserIds(parentRow.employee_id, client);
          parentVisible.filter(Boolean).forEach((visibleUserId) => {
            mergedVisibleUsers.add(visibleUserId);
          });
        }
      }
    }
  } catch (err) {
    // Non-fatal: fall back to base accessible list
    console.warn("[visibility] co-leader parent resolution failed", { error: err?.message });
  }

  return [...mergedVisibleUsers].sort();
}

async function resolveAccessibleProjectIds(user, departmentId = null, client = pool) {
  if (hasOrgWideVisibility(user)) {
    const params = [departmentId || null];
    const result = await client.query(
      `
        SELECT p.id::text AS project_id
        FROM design.projects p
        WHERE ($1::text IS NULL OR p.department_id = $1)
        ORDER BY p.updated_at DESC, p.created_at DESC, p.id ASC
      `,
      params,
    );
    if (process.env.PROJECT_VISIBILITY_DEBUG === "true") {
      const visibleUsers = await resolveAccessibleUserIds(user, client);
      console.info("[project-visibility-debug] AUTHORITY_USER", {
        resolved_role: getRoleId(user),
        resolved_role_name: user?.role?.name || user?.role_details?.name || null,
        visibility_mode: "org_wide_authority",
        visible_users_count: visibleUsers.length,
        project_count: result.rows.length,
        authority_detection: "HARD_BYPASS_SUCCESS",
      });
    }
    return result.rows.map((row) => row.project_id).filter(Boolean);
  }

  const projects = await getAccessibleProjectIds(user?.employee_id, departmentId, client);
  if (process.env.PROJECT_VISIBILITY_DEBUG === "true") {
    const visibleUsers = await resolveAccessibleUserIds(user, client);
    console.info("[project-visibility-debug] HIERARCHICAL_USER", {
      resolved_role: getRoleId(user),
      resolved_role_name: user?.role?.name || user?.role_details?.name || null,
      visibility_mode: "hierarchical",
      visible_users_count: visibleUsers.length,
      project_count: projects.length,
      authority_detection: "NOT_AUTHORITY_USER",
    });
  }

  return projects;
}

async function explainProjectVisibility(user, projectId, client = pool) {
  const normalizedProjectId = String(projectId || "").trim();
  if (!user?.employee_id || !normalizedProjectId) {
    return {
      allowed: false,
      reasons: [VISIBILITY_REASONS.DENIED],
      context: getVisibilityContext(user),
    };
  }

  const projectResult = await client.query(
    `
      SELECT
        p.id::text AS project_id,
        p.department_id,
        p.created_by_user_id
      FROM design.projects p
      WHERE p.id = $1
      LIMIT 1
    `,
    [normalizedProjectId],
  );
  const project = projectResult.rows[0];

  if (!project) {
    return {
      allowed: false,
      reasons: [VISIBILITY_REASONS.DENIED],
      context: getVisibilityContext(user),
      project: null,
    };
  }

  const context = getVisibilityContext(user);
  const accessibleUserIds = await resolveAccessibleUserIds(user, client);
  const reasons = [];

  if (context.org_wide_visibility) {
    reasons.push(VISIBILITY_REASONS.ORG_WIDE_AUTHORITY);
  }

  if (project.created_by_user_id && accessibleUserIds.includes(project.created_by_user_id)) {
    reasons.push(VISIBILITY_REASONS.DESCENDANT_UPLOADER);
  }

  if (accessibleUserIds.length > 0) {
    const assignmentResult = await client.query(
      `
        SELECT 1
        FROM design.fixtures visible_fixture
        JOIN fixture_workflow_progress visible_progress
          ON visible_progress.fixture_id = visible_fixture.id
        WHERE visible_fixture.project_id = $1
          AND visible_progress.assigned_to = ANY($2::text[])
        LIMIT 1
      `,
      [normalizedProjectId, accessibleUserIds],
    );
    if (assignmentResult.rows.length > 0) {
      reasons.push(VISIBILITY_REASONS.ASSIGNED_WORKFLOW);
    }
  }

  return {
    allowed: reasons.length > 0,
    reasons,
    context,
    project,
    accessible_user_ids: accessibleUserIds,
  };
}

async function resolveProjectDepartmentForUser(user, projectId, requestedDepartmentId, client = pool) {
  const normalizedProjectId = String(projectId || "").trim();
  const requested = String(requestedDepartmentId || "").trim();

  if (requested) {
    return requested;
  }

  if (!normalizedProjectId) {
    return null;
  }

  const result = await client.query(
    `
      ${buildVisibleUsersCte("$1")}
      SELECT department_id
      FROM design.projects p
      WHERE p.id = $2
        AND ${visibleProjectPredicate("p")}
      LIMIT 1
    `,
    [user.employee_id, normalizedProjectId],
  );

  return result.rows[0]?.department_id || null;
}

function groupProjectsByTeamLeader(projects = []) {
  const groups = new Map();

  for (const project of projects) {
    const leaderId = project.team_lead_id || "__unassigned__";
    const leaderName = project.team_lead_name || "No operational team leader assigned";
    const key = `${leaderId}::${leaderName}`;

    if (!groups.has(key)) {
      groups.set(key, {
        team_leader_id: leaderId === "__unassigned__" ? null : leaderId,
        team_leader_name: leaderName,
        projects: [],
      });
    }

    groups.get(key).projects.push(project);
  }

  return [...groups.values()].sort((left, right) =>
    String(left.team_leader_name).localeCompare(String(right.team_leader_name)),
  );
}

module.exports = {
  VISIBILITY_REASONS,
  GetAccessibleUserIds,
  buildAuthoritativeFixtureVisibilityPredicate,
  buildAuthoritativeProjectVisibilityPredicate,
  buildVisibleUsersCte,
  explainProjectVisibility,
  getVisibilityContext,
  groupProjectsByTeamLeader,
  hasOrgWideVisibility,
  projectOwnershipMatchSql,
  resolveAccessibleProjectIds,
  resolveAccessibleUserIds,
  resolveProjectDepartmentForUser,
  visibleFixturePredicate,
  visibleProjectPredicate,
};
