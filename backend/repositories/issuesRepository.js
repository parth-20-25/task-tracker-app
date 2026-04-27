const { pool } = require("../db");
const { mapUserRow } = require("./mappers");
const { buildUserColumns } = require("./sqlFragments");

function mapIssueRow(row) {
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    title: row.title,
    description: row.description,
    created_by: row.created_by,
    assigned_to: row.assigned_to,
    department_id: row.department_id,
    priority: row.priority,
    status: row.status,
    created_at: row.created_at,
    creator: mapUserRow(row, "creator_"),
    assignee: mapUserRow(row, "assignee_"),
    department: row.department_id
      ? {
          id: row.department_id,
          name: row.department_name || row.department_id,
          parent_department: row.department_parent_department || null,
        }
      : null,
    comments: row.comments || [],
  };
}

function issueSelect(whereClause = "") {
  return `
    SELECT
      i.*,
      d.name AS department_name,
      d.parent_department AS department_parent_department,
      ${buildUserColumns({ userAlias: "creator", roleAlias: "creator_role", departmentAlias: "creator_department", prefix: "creator_" })},
      ${buildUserColumns({ userAlias: "assignee", roleAlias: "assignee_role", departmentAlias: "assignee_department", prefix: "assignee_" })}
    FROM issues i
    LEFT JOIN departments d ON d.id = i.department_id
    LEFT JOIN users creator ON creator.employee_id = i.created_by
    LEFT JOIN roles creator_role ON creator_role.id = creator.role
    LEFT JOIN departments creator_department ON creator_department.id = creator.department_id
    LEFT JOIN users assignee ON assignee.employee_id = i.assigned_to
    LEFT JOIN roles assignee_role ON assignee_role.id = assignee.role
    LEFT JOIN departments assignee_department ON assignee_department.id = assignee.department_id
    ${whereClause}
  `;
}

async function createIssue(issue, client = pool) {
  const result = await client.query(
    `
      INSERT INTO issues (
        title,
        description,
        created_by,
        assigned_to,
        department_id,
        priority,
        status
      )
      VALUES ($1, $2, $3, $4, $5, $6, 'OPEN')
      RETURNING id
    `,
    [
      issue.title,
      issue.description,
      issue.created_by,
      issue.assigned_to,
      issue.department_id || null,
      issue.priority,
    ],
  );

  return findIssueById(result.rows[0].id, client);
}

async function hasRecentDuplicateIssue(createdBy, title, client = pool) {
  const result = await client.query(
    `
      SELECT 1
      FROM issues
      WHERE created_by = $1
        AND LOWER(BTRIM(title)) = LOWER(BTRIM($2))
        AND created_at >= NOW() - INTERVAL '10 minutes'
      LIMIT 1
    `,
    [createdBy, title],
  );

  return result.rowCount > 0;
}

async function findIssueById(issueId, client = pool) {
  const result = await client.query(
    `${issueSelect("WHERE i.id = $1")} LIMIT 1`,
    [issueId],
  );

  return mapIssueRow(result.rows[0]);
}

async function listIssuesByMode(user, { mode, isAdmin }, client = pool) {
  if (isAdmin) {
    const result = await client.query(
      `${issueSelect()} ORDER BY i.created_at DESC, i.id DESC LIMIT 250`,
    );
    return result.rows.map(mapIssueRow);
  }

  const predicate = mode === "assigned"
    ? "i.assigned_to = $1"
    : "i.created_by = $1";

  const result = await client.query(
    `
      ${issueSelect(`WHERE ${predicate} AND i.department_id = $2`)}
      ORDER BY i.created_at DESC, i.id DESC
      LIMIT 250
    `,
    [user.employee_id, user.department_id],
  );

  return result.rows.map(mapIssueRow);
}

async function listHigherUpsInDepartment(user, roleLevel, client = pool) {
  const result = await client.query(
    `
      SELECT
        ${buildUserColumns({ userAlias: "u", roleAlias: "r", departmentAlias: "d" })}
      FROM users u
      JOIN roles r ON r.id = u.role
      LEFT JOIN departments d ON d.id = u.department_id
      WHERE u.department_id = $1
        AND u.employee_id <> $2
        AND COALESCE(u.is_active, TRUE) = TRUE
        AND r.hierarchy_level < $3
      ORDER BY r.hierarchy_level ASC, u.employee_id ASC
    `,
    [user.department_id, user.employee_id, roleLevel],
  );

  return result.rows.map(mapUserRow).filter(Boolean);
}

async function listAdminUsers(client = pool) {
  const result = await client.query(
    `
      SELECT
        ${buildUserColumns({ userAlias: "u", roleAlias: "r", departmentAlias: "d" })}
      FROM users u
      JOIN roles r ON r.id = u.role
      LEFT JOIN departments d ON d.id = u.department_id
      WHERE COALESCE(u.is_active, TRUE) = TRUE
        AND r.hierarchy_level = 1
      ORDER BY u.employee_id ASC
    `,
  );

  return result.rows.map(mapUserRow).filter(Boolean);
}

async function addIssueComment(comment, client = pool) {
  const result = await client.query(
    `
      INSERT INTO issue_comments (issue_id, user_id, message)
      VALUES ($1, $2, $3)
      RETURNING id, issue_id, user_id, message, created_at
    `,
    [comment.issue_id, comment.user_id, comment.message],
  );

  return result.rows[0];
}

async function listIssueComments(issueId, client = pool) {
  const result = await client.query(
    `
      SELECT
        ic.id,
        ic.issue_id,
        ic.user_id,
        ic.message,
        ic.created_at,
        u.name AS user_name
      FROM issue_comments ic
      LEFT JOIN users u ON u.employee_id = ic.user_id
      WHERE ic.issue_id = $1
      ORDER BY ic.created_at ASC, ic.id ASC
    `,
    [issueId],
  );

  return result.rows;
}

async function updateIssueStatus(issueId, status, client = pool) {
  await client.query(
    `
      UPDATE issues
      SET status = $2
      WHERE id = $1
    `,
    [issueId, status],
  );

  return findIssueById(issueId, client);
}

module.exports = {
  addIssueComment,
  createIssue,
  findIssueById,
  hasRecentDuplicateIssue,
  listAdminUsers,
  listHigherUpsInDepartment,
  listIssueComments,
  listIssuesByMode,
  updateIssueStatus,
};
