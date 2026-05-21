const { pool } = require("../db");
const {
  GetAccessibleUserIds,
  buildVisibleUsersCte,
  getAccessibleProjectIds,
  isProjectAuthorityRoleIdentity,
  isProjectAuthorityRoleLevel,
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
  DESCENDANT_TEAM_LEAD: "descendant_team_lead",
  DESCENDANT_PROJECT_LEADER: "descendant_project_leader",
  DEPARTMENT_SCOPE: "department_scope",
  DIRECT_ASSIGNMENT: "direct_assignment",
  DENIED: "denied",
};

function hasOrgWideVisibility(user) {
  const roleDetails = getRoleDetails(user);
  const roleLevel = getRoleLevel(user);

  return isProjectAuthorityRoleLevel(roleLevel)
    || isProjectAuthorityRoleIdentity(roleDetails?.name)
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
  return `
    COALESCE(${projectAlias}.uploaded_by IN (SELECT employee_id FROM ${cteName}), FALSE)
    OR COALESCE(${projectAlias}.team_lead_id IN (SELECT employee_id FROM ${cteName}), FALSE)
    OR COALESCE(${projectAlias}.project_leader_id IN (SELECT employee_id FROM ${cteName}), FALSE)
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

  if (Array.isArray(user?.visible_user_ids) && user.visible_user_ids.length > 0) {
    const merged = new Set(user.visible_user_ids.filter(Boolean));
    merged.add(employeeId);
    return [...merged].sort();
  }

  return GetAccessibleUserIds(employeeId, client);
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
    return result.rows.map((row) => row.project_id).filter(Boolean);
  }

  return getAccessibleProjectIds(user?.employee_id, departmentId, client);
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
        p.uploaded_by,
        p.team_lead_id,
        p.project_leader_id
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

  if (project.uploaded_by && accessibleUserIds.includes(project.uploaded_by)) {
    reasons.push(VISIBILITY_REASONS.DESCENDANT_UPLOADER);
  }

  if (project.team_lead_id && accessibleUserIds.includes(project.team_lead_id)) {
    reasons.push(VISIBILITY_REASONS.DESCENDANT_TEAM_LEAD);
  }

  if (project.project_leader_id && accessibleUserIds.includes(project.project_leader_id)) {
    reasons.push(VISIBILITY_REASONS.DESCENDANT_PROJECT_LEADER);
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

  if (!hasOrgWideVisibility(user)) {
    return String(user?.department_id || "").trim() || null;
  }

  if (!normalizedProjectId) {
    return null;
  }

  const result = await client.query(
    `
      SELECT department_id
      FROM design.projects
      WHERE id = $1
      LIMIT 1
    `,
    [normalizedProjectId],
  );

  return result.rows[0]?.department_id || null;
}

function groupProjectsByTeamLeader(projects = []) {
  const groups = new Map();

  for (const project of projects) {
    const leaderId = project.team_lead_id || project.project_leader_id || "__unassigned__";
    const leaderName = project.team_lead_name || project.project_leader_name || "No operational team leader assigned";
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
