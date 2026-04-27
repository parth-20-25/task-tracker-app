const { pool } = require("../db");
const { AppError } = require("../lib/AppError");
const { instrumentModuleExports } = require("../lib/observability");
const { createAuditLog } = require("../repositories/auditRepository");
const { findUserByEmployeeId } = require("../repositories/usersRepository");
const {
  addIssueComment,
  createIssue,
  findIssueById,
  hasRecentDuplicateIssue,
  listAdminUsers,
  listHigherUpsInDepartment,
  listIssueComments,
  listIssuesByMode,
  updateIssueStatus,
} = require("../repositories/issuesRepository");
const { getRoleLevel, isAdmin } = require("./accessControlService");

const ISSUE_PRIORITIES = ["LOW", "MEDIUM", "HIGH"];
const ISSUE_STATUSES = ["OPEN", "IN_PROGRESS", "RESOLVED", "CLOSED"];

function normalizeTarget(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/-/g, "_");
}

function normalizePriority(value) {
  const priority = String(value || "MEDIUM").trim().toUpperCase();
  return ISSUE_PRIORITIES.includes(priority) ? priority : null;
}

function normalizeStatus(value) {
  const status = String(value || "").trim().toUpperCase();
  return ISSUE_STATUSES.includes(status) ? status : null;
}

function assertCanViewIssue(user, issue) {
  if (!issue) {
    throw new AppError(404, "Issue not found");
  }

  if (isAdmin(user)) {
    return;
  }

  const inSameDepartment = Boolean(user.department_id && issue.department_id === user.department_id);
  const participant = issue.created_by === user.employee_id || issue.assigned_to === user.employee_id;

  if (!inSameDepartment || !participant) {
    throw new AppError(403, "You do not have access to this issue");
  }
}

async function resolveIssueAssignees(user, payload) {
  const target = normalizeTarget(payload.target || payload.target_type);

  if (target === "higher_ups") {
    const roleLevel = getRoleLevel(user);
    if (!user.department_id || !roleLevel) {
      throw new AppError(400, "Cannot resolve higher-ups for this user");
    }

    return listHigherUpsInDepartment(user, roleLevel);
  }

  if (target === "admin") {
    return listAdminUsers();
  }

  if (target === "specific_user") {
    const employeeId = String(payload.assigned_to || payload.specific_user_id || "").trim();
    if (!employeeId) {
      throw new AppError(400, "assigned_to is required for a specific user issue");
    }

    const targetUser = await findUserByEmployeeId(employeeId);
    if (!targetUser || targetUser.is_active === false) {
      throw new AppError(404, "Assigned user not found");
    }

    const targetIsAdmin = getRoleLevel(targetUser) === 1;
    if (!isAdmin(user) && !targetIsAdmin && targetUser.department_id !== user.department_id) {
      throw new AppError(403, "Cannot assign an issue outside your department");
    }

    return [targetUser];
  }

  throw new AppError(400, "Invalid issue target");
}

function resolveIssueDepartment(user, assignee) {
  if (user.department_id) {
    return user.department_id;
  }

  return assignee.department_id || null;
}

async function createIssueForUser(user, payload = {}) {
  const title = String(payload.title || "").trim();
  const description = String(payload.description || "").trim();
  const priority = normalizePriority(payload.priority);

  if (!title || !description) {
    throw new AppError(400, "Issue title and description are required");
  }

  if (!priority) {
    throw new AppError(400, "Invalid issue priority");
  }

  if (await hasRecentDuplicateIssue(user.employee_id, title)) {
    throw new AppError(409, "Duplicate issue detected. Please wait before reporting the same issue again.", null, "DUPLICATE_ISSUE");
  }

  const assignees = await resolveIssueAssignees(user, payload);
  const activeAssignees = assignees.filter((assignee) => assignee?.employee_id && assignee.is_active !== false);

  if (activeAssignees.length === 0) {
    throw new AppError(400, "Every issue must have an owner");
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const issues = [];

    for (const assignee of activeAssignees) {
      const issue = await createIssue({
        title,
        description,
        created_by: user.employee_id,
        assigned_to: assignee.employee_id,
        department_id: resolveIssueDepartment(user, assignee),
        priority,
      }, client);
      issues.push(issue);
    }

    await createAuditLog({
      userEmployeeId: user.employee_id,
      actionType: "CREATE_ISSUE",
      targetType: "issue",
      targetId: issues.map((issue) => issue.id).join(","),
      metadata: {
        target: normalizeTarget(payload.target || payload.target_type),
        count: issues.length,
        priority,
      },
    }, client);

    await client.query("COMMIT");
    return { issues };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function listMyIssues(user) {
  return listIssuesByMode(user, { mode: "created", isAdmin: isAdmin(user) });
}

async function listAssignedIssues(user) {
  return listIssuesByMode(user, { mode: "assigned", isAdmin: isAdmin(user) });
}

async function commentOnIssue(user, issueId, payload = {}) {
  const issue = await findIssueById(issueId);
  assertCanViewIssue(user, issue);

  const message = String(payload.message || "").trim();
  if (!message) {
    throw new AppError(400, "Comment message is required");
  }

  const comment = await addIssueComment({
    issue_id: issueId,
    user_id: user.employee_id,
    message,
  });

  return comment;
}

async function getIssueCommentsForUser(user, issueId) {
  const issue = await findIssueById(issueId);
  assertCanViewIssue(user, issue);
  return listIssueComments(issueId);
}

async function updateIssueStatusForUser(user, issueId, payload = {}) {
  const nextStatus = normalizeStatus(payload.status);
  if (!nextStatus) {
    throw new AppError(400, "Invalid issue status");
  }

  const issue = await findIssueById(issueId);
  assertCanViewIssue(user, issue);

  if (!isAdmin(user) && issue.assigned_to !== user.employee_id) {
    throw new AppError(403, "Only the issue owner can update status");
  }

  if (issue.status === nextStatus) {
    return issue;
  }

  const currentIndex = ISSUE_STATUSES.indexOf(issue.status);
  const nextIndex = ISSUE_STATUSES.indexOf(nextStatus);

  if (nextIndex !== currentIndex + 1) {
    throw new AppError(400, `Invalid status transition. Next status must be ${ISSUE_STATUSES[currentIndex + 1] || "unchanged"}.`);
  }

  const updatedIssue = await updateIssueStatus(issueId, nextStatus);

  await createAuditLog({
    userEmployeeId: user.employee_id,
    actionType: "UPDATE_ISSUE_STATUS",
    targetType: "issue",
    targetId: issueId,
    metadata: {
      from: issue.status,
      to: nextStatus,
    },
  });

  return updatedIssue;
}

module.exports = instrumentModuleExports("service.issueService", {
  commentOnIssue,
  createIssueForUser,
  getIssueCommentsForUser,
  listAssignedIssues,
  listMyIssues,
  updateIssueStatusForUser,
});
