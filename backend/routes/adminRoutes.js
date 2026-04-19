const express = require("express");
const { PERMISSIONS, USER_SCOPES } = require("../config/constants");
const { asyncHandler } = require("../lib/asyncHandler");
const { sendSuccess } = require("../lib/response");
const { authenticate } = require("../middleware/authenticate");
const { authorize, requireAdmin } = require("../middleware/authorize");
const {
  getAdminReferenceData,
  listUsersForScope,
  saveDepartment,
  saveEscalationRule,
  saveKpiDefinition,
  saveRole,
  saveUser,
  deleteDepartment,
  deleteRole,
  deleteUser,
  saveShift,
  deleteShift,
  saveMachine,
  deleteMachine,
  toggleEscalationRule,
  deleteEscalationRule,
  updateUserStatus,
} = require("../services/adminService");
const {
  createWorkflow,
  updateWorkflow,
  getWorkflow,
  deleteWorkflow,
  createWorkflowStage,
  updateWorkflowStage,
  deleteWorkflowStage,
  createWorkflowTransition,
  updateWorkflowTransition,
  deleteWorkflowTransition,
} = require("../services/workflowAdminService");
const { listRoles } = require("../repositories/rolesRepository");
const { listDepartments, listAllDepartments } = require("../repositories/departmentsRepository");
const { listAuditLogs } = require("../repositories/auditRepository");
const { listShifts } = require("../repositories/shiftsRepository");
const { listMachines } = require("../repositories/machinesRepository");
const {
  listEscalationRules,
  listKpiDefinitions,
} = require("../repositories/referenceRepository");
const { listWorkflows } = require("../repositories/workflowAdminRepository");

const router = express.Router();

router.use(authenticate);

router.get(
  "/users",
  asyncHandler(async (req, res) => {
    const users = await listUsersForScope(req.user, req.query.scope || USER_SCOPES.ACCESSIBLE);
    return sendSuccess(res, users);
  }),
);

router.put(
  "/users/:employeeId",
  authorize(PERMISSIONS.MANAGE_USERS),
  asyncHandler(async (req, res) => sendSuccess(res, await saveUser(req.user, {
    ...req.body,
    employee_id: req.params.employeeId,
  }))),
);

router.patch(
  "/users/:employeeId/status",
  authorize(PERMISSIONS.MANAGE_USERS),
  asyncHandler(async (req, res) => sendSuccess(res, await updateUserStatus(req.user, req.params.employeeId, req.body.is_active !== false))),
);

router.delete(
  "/users/:employeeId",
  authorize(PERMISSIONS.MANAGE_USERS),
  asyncHandler(async (req, res) => sendSuccess(res, await deleteUser(req.user, req.params.employeeId))),
);

router.get(
  "/roles",
  authorize(PERMISSIONS.MANAGE_ROLES),
  asyncHandler(async (_req, res) => sendSuccess(res, await listRoles())),
);

router.put(
  "/roles/:roleId",
  authorize(PERMISSIONS.MANAGE_ROLES),
  asyncHandler(async (req, res) => sendSuccess(res, await saveRole(req.user, {
    ...req.body,
    id: req.params.roleId,
  }))),
);

router.delete(
  "/roles/:roleId",
  authorize(PERMISSIONS.MANAGE_ROLES),
  asyncHandler(async (req, res) => sendSuccess(res, await deleteRole(req.user, req.params.roleId))),
);

router.get(
  "/departments",
  authorize(PERMISSIONS.MANAGE_DEPARTMENTS),
  asyncHandler(async (_req, res) => sendSuccess(res, await listDepartments())),
);

router.get(
  "/all-departments",
  authorize(PERMISSIONS.MANAGE_DEPARTMENTS),
  asyncHandler(async (_req, res) => sendSuccess(res, await listAllDepartments())),
);

router.put(
  "/departments/:departmentId",
  authorize(PERMISSIONS.MANAGE_DEPARTMENTS),
  asyncHandler(async (req, res) => sendSuccess(res, await saveDepartment(req.user, {
    ...req.body,
    id: req.params.departmentId,
  }))),
);

router.delete(
  "/departments/:departmentId",
  authorize(PERMISSIONS.MANAGE_DEPARTMENTS),
  asyncHandler(async (req, res) => sendSuccess(res, await deleteDepartment(req.user, req.params.departmentId))),
);

router.get(
  "/shifts",
  authorize(PERMISSIONS.MANAGE_SHIFTS),
  asyncHandler(async (_req, res) => sendSuccess(res, await listShifts())),
);

router.put(
  "/shifts/:shiftId",
  authorize(PERMISSIONS.MANAGE_SHIFTS),
  asyncHandler(async (req, res) => sendSuccess(res, await saveShift(req.user, {
    ...req.body,
    id: req.params.shiftId,
  }))),
);

router.delete(
  "/shifts/:shiftId",
  authorize(PERMISSIONS.MANAGE_SHIFTS),
  asyncHandler(async (req, res) => sendSuccess(res, await deleteShift(req.user, req.params.shiftId))),
);

router.get(
  "/machines",
  authorize(PERMISSIONS.MANAGE_MACHINES),
  asyncHandler(async (_req, res) => sendSuccess(res, await listMachines())),
);

router.put(
  "/machines/:machineId",
  authorize(PERMISSIONS.MANAGE_MACHINES),
  asyncHandler(async (req, res) => sendSuccess(res, await saveMachine(req.user, {
    ...req.body,
    id: req.params.machineId,
  }))),
);

router.delete(
  "/machines/:machineId",
  authorize(PERMISSIONS.MANAGE_MACHINES),
  asyncHandler(async (req, res) => sendSuccess(res, await deleteMachine(req.user, req.params.machineId))),
);

router.get(
  "/audit-logs",
  requireAdmin,
  asyncHandler(async (_req, res) => sendSuccess(res, await listAuditLogs())),
);

router.get(
  "/admin/reference-data",
  requireAdmin,
  asyncHandler(async (_req, res) => sendSuccess(res, await getAdminReferenceData())),
);

router.get(
  "/kpi-definitions",
  requireAdmin,
  asyncHandler(async (_req, res) => sendSuccess(res, await listKpiDefinitions())),
);

router.put(
  "/kpi-definitions/:kpiId",
  requireAdmin,
  asyncHandler(async (req, res) => sendSuccess(res, await saveKpiDefinition(req.user, {
    ...req.body,
    id: req.params.kpiId,
  }))),
);

router.get(
  "/escalation-rules",
  requireAdmin,
  asyncHandler(async (_req, res) => sendSuccess(res, await listEscalationRules())),
);

router.put(
  "/escalation-rules/:ruleId",
  requireAdmin,
  asyncHandler(async (req, res) => sendSuccess(res, await saveEscalationRule(req.user, {
    ...req.body,
    id: req.params.ruleId,
  }))),
);

router.patch(
  "/escalation-rules/:ruleId/toggle",
  requireAdmin,
  asyncHandler(async (req, res) => sendSuccess(res, await toggleEscalationRule(req.user, req.params.ruleId, req.body.is_active))),
);

router.delete(
  "/escalation-rules/:ruleId",
  requireAdmin,
  asyncHandler(async (req, res) => sendSuccess(res, await deleteEscalationRule(req.user, req.params.ruleId))),
);

// ============ WORKFLOW MANAGEMENT ============

router.get(
  "/workflows",
  authorize(PERMISSIONS.MANAGE_WORKFLOWS),
  asyncHandler(async (_req, res) => sendSuccess(res, await listWorkflows())),
);

router.post(
  "/workflows",
  authorize(PERMISSIONS.MANAGE_WORKFLOWS),
  asyncHandler(async (req, res) => sendSuccess(res, await createWorkflow(req.user, req.body))),
);

router.get(
  "/workflows/:workflowId",
  authorize(PERMISSIONS.MANAGE_WORKFLOWS),
  asyncHandler(async (req, res) => sendSuccess(res, await getWorkflow(req.params.workflowId))),
);

router.put(
  "/workflows/:workflowId",
  authorize(PERMISSIONS.MANAGE_WORKFLOWS),
  asyncHandler(async (req, res) => sendSuccess(res, await updateWorkflow(req.user, req.params.workflowId, req.body))),
);

router.delete(
  "/workflows/:workflowId",
  authorize(PERMISSIONS.MANAGE_WORKFLOWS),
  asyncHandler(async (req, res) => sendSuccess(res, await deleteWorkflow(req.user, req.params.workflowId))),
);

// ============ WORKFLOW STAGES ============

router.post(
  "/workflows/:workflowId/stages",
  authorize(PERMISSIONS.MANAGE_WORKFLOWS),
  asyncHandler(async (req, res) => sendSuccess(res, await createWorkflowStage(req.user, {
    ...req.body,
    workflow_id: req.params.workflowId,
  }))),
);

router.put(
  "/workflows/:workflowId/stages/:stageId",
  authorize(PERMISSIONS.MANAGE_WORKFLOWS),
  asyncHandler(async (req, res) => sendSuccess(res, await updateWorkflowStage(req.user, req.params.stageId, req.body))),
);

router.delete(
  "/workflows/:workflowId/stages/:stageId",
  authorize(PERMISSIONS.MANAGE_WORKFLOWS),
  asyncHandler(async (req, res) => sendSuccess(res, await deleteWorkflowStage(req.user, req.params.stageId))),
);

// ============ WORKFLOW TRANSITIONS ============

router.post(
  "/workflows/:workflowId/transitions",
  authorize(PERMISSIONS.MANAGE_WORKFLOWS),
  asyncHandler(async (req, res) => sendSuccess(res, await createWorkflowTransition(req.user, {
    ...req.body,
    workflow_id: req.params.workflowId,
  }))),
);

router.put(
  "/workflows/:workflowId/transitions/:transitionId",
  authorize(PERMISSIONS.MANAGE_WORKFLOWS),
  asyncHandler(async (req, res) => sendSuccess(res, await updateWorkflowTransition(req.user, req.params.transitionId, req.body))),
);

router.delete(
  "/workflows/:workflowId/transitions/:transitionId",
  authorize(PERMISSIONS.MANAGE_WORKFLOWS),
  asyncHandler(async (req, res) => sendSuccess(res, await deleteWorkflowTransition(req.user, req.params.transitionId))),
);

module.exports = {
  adminRoutes: router,
};
