const { pool } = require("../db");
const { AppError } = require("../lib/AppError");
const { createAuditLog } = require("../repositories/auditRepository");
const {
  assignProjectTo2DLeader,
  canManageProject2DRouting,
  list2DLeadersForProject,
  deleteProjectSubdivisionAssignment,
  listProjectSubdivisionAssignments,
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
  const twoDAssignments = assignments.filter((assignment) => (
    String(assignment.subdivision_name || "").trim().toLowerCase() === "2d"
  ));
  const assignedLeaderIds = new Set(twoDAssignments.map((assignment) => assignment.assigned_leader_id));

  return {
    project_id: projectId,
    eligible_leaders: leaders.filter((leader) => !assignedLeaderIds.has(leader.employee_id)),
    assignments: twoDAssignments,
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

async function deleteProject2DAssignment(user, projectId, assignmentId) {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    await require2DRoutingManager(user, projectId, client);
    const deleted = await deleteProjectSubdivisionAssignment(projectId, assignmentId, client);

    await createAuditLog({
      userEmployeeId: user.employee_id,
      actionType: "PROJECT_2D_ASSIGNMENT_DELETED",
      targetType: "design_project_subdivision_assignment",
      targetId: assignmentId,
      metadata: {
        project_id: projectId,
        assigned_leader_id: deleted.assigned_leader_id || null,
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
  deleteProject2DAssignment,
  getProject2DRouting,
};
