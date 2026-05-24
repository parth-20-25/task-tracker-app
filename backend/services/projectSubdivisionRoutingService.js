const { pool } = require("../db");
const { AppError } = require("../lib/AppError");
const { createAuditLog } = require("../repositories/auditRepository");
const {
  assignProjectTo2DLeader,
  canManageProject2DRouting,
  list2DLeadersForProject,
  listProjectSubdivisionAssignments,
  setProjectSubdivisionAssignmentActive,
} = require("../repositories/projectSubdivisionRoutingRepository");

async function require2DRoutingManager(user, projectId, client = pool) {
  const allowed = await canManageProject2DRouting(user, projectId, client);
  if (!allowed) {
    throw new AppError(403, "You do not have permission to manage 2D routing for this project");
  }
}

async function getProject2DRouting(user, projectId) {
  await require2DRoutingManager(user, projectId);

  const [leaders, assignments] = await Promise.all([
    list2DLeadersForProject(projectId),
    listProjectSubdivisionAssignments(projectId),
  ]);

  return {
    project_id: projectId,
    eligible_leaders: leaders,
    assignments: assignments.filter((assignment) => (
      String(assignment.subdivision_name || "").trim().toLowerCase() === "2d"
    )),
  };
}

async function assignProject2DLeader(user, projectId, assignedLeaderId) {
  const client = await pool.connect();
  let assignment;

  try {
    await client.query("BEGIN");
    await require2DRoutingManager(user, projectId, client);
    assignment = await assignProjectTo2DLeader({
      projectId,
      assignedLeaderId,
      assignedBy: user.employee_id,
    }, client);

    await createAuditLog({
      userEmployeeId: user.employee_id,
      actionType: "PROJECT_ASSIGNED_TO_2D",
      targetType: "design_project",
      targetId: projectId,
      metadata: {
        assignment_id: assignment?.id || null,
        assigned_leader_id: assignedLeaderId,
      },
    }, client);

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  return assignment;
}

async function updateProject2DAssignmentStatus(user, projectId, assignmentId, isActive) {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    await require2DRoutingManager(user, projectId, client);
    const changedProjectId = await setProjectSubdivisionAssignmentActive(assignmentId, isActive === true, client);
    if (String(changedProjectId) !== String(projectId)) {
      throw new AppError(400, "Assignment does not belong to the selected project");
    }

    await createAuditLog({
      userEmployeeId: user.employee_id,
      actionType: isActive === true ? "PROJECT_2D_ASSIGNMENT_ACTIVATED" : "PROJECT_2D_ASSIGNMENT_DEACTIVATED",
      targetType: "design_project_subdivision_assignment",
      targetId: assignmentId,
      metadata: {
        project_id: projectId,
        is_active: isActive === true,
      },
    }, client);

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  return getProject2DRouting(user, projectId);
}

module.exports = {
  assignProject2DLeader,
  getProject2DRouting,
  updateProject2DAssignmentStatus,
};
