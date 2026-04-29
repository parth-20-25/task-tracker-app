const express = require("express");
const { asyncHandler } = require("../lib/asyncHandler");
const { AppError } = require("../lib/AppError");
const { logger } = require("../lib/logger");
const { sendSuccess } = require("../lib/response");
const {
  TASK_PROOF_MAX_SIZE_MB,
  buildTaskProofFileUrl,
  handleTaskProofUpload,
  removeStoredTaskProof,
  sanitizeOriginalFileName,
} = require("../lib/taskProofUpload");
const { authenticate } = require("../middleware/authenticate");
const { PERMISSIONS } = require("../config/constants");
const {
  cancelTaskForUser,
  createTaskForUser,
  ensureTaskProofUpdateAllowed,
  listTaskActivityForUser,
  listTasksForUser,
  listVerificationTasksForUser,
  transitionTaskForUser,
  updateTaskForUser,
} = require("../services/taskService");
const {
  appendTaskActivity,
  findTaskById,
  listTaskLogs,
  addTaskLog,
  listTaskChecklists,
  addTaskChecklist,
  updateTaskChecklist,
  deleteTaskChecklist,
  listTaskAttachments,
  addTaskAttachment,
  deleteTaskAttachment,
} = require("../repositories/tasksRepository");
const { authorize } = require("../middleware/authorize");
const { requireAnyPermission } = require("../middleware/requirePermission");
const { canAccessTask } = require("../services/accessControlService");

const router = express.Router();

router.use(authenticate);

async function loadTaskForAccess(user, taskId) {
  const task = await findTaskById(Number(taskId));

  if (!task) {
    throw new AppError(404, "Task not found");
  }

  if (!canAccessTask(user, task)) {
    throw new AppError(403, "You do not have permission to access this task");
  }

  return task;
}

router.get(
  "/tasks",
  asyncHandler(async (req, res) => {
    const tasks = await listTasksForUser(req.user);
    return sendSuccess(res, tasks);
  }),
);

router.get(
  "/tasks/verification-queue",
  requireAnyPermission([PERMISSIONS.VERIFY_TASK, PERMISSIONS.APPROVE_QUALITY]),
  asyncHandler(async (req, res) => {
    const tasks = await listVerificationTasksForUser(req.user);
    return sendSuccess(res, tasks);
  }),
);

router.post(
  "/tasks",
  authorize("can_create_task"),
  asyncHandler(async (req, res) => {
    const task = await createTaskForUser(req.user, req.body);
    logger.info("Task created", { taskId: task.id, user: req.user.employee_id });
    return sendSuccess(res, task, 201);
  }),
);

router.patch(
  "/tasks/:taskId",
  requireAnyPermission([PERMISSIONS.EDIT_TASK, PERMISSIONS.VERIFY_TASK, PERMISSIONS.APPROVE_QUALITY]),
  asyncHandler(async (req, res) => {
    const task = await updateTaskForUser(req.user, req.params.taskId, req.body);
    return sendSuccess(res, task);
  }),
);

router.delete(
  "/tasks/:taskId",
  authorize("can_assign_tasks"),
  asyncHandler(async (req, res) => {
    const task = await cancelTaskForUser(req.user, req.params.taskId, req.body?.reason);
    logger.info("Task deleted", { taskId: req.params.taskId, user: req.user.employee_id });
    return sendSuccess(res, task);
  }),
);

router.post(
  "/tasks/:id/transition",
  authorize("can_edit_task"),
  asyncHandler(async (req, res) => {
    const body = req.body || {};
    await loadTaskForAccess(req.user, req.params.id);
    const task = await transitionTaskForUser(req.user, req.params.id, body.next_stage_id);
    logger.info("Task transitioned", { taskId: req.params.id, user: req.user.employee_id, next_stage: body.next_stage_id });
    return sendSuccess(res, task);
  }),
);

router.get(
  "/tasks/:taskId/activity",
  asyncHandler(async (req, res) => {
    const activity = await listTaskActivityForUser(req.user, req.params.taskId);
    return sendSuccess(res, activity);
  }),
);

router.get(
  "/tasks/:taskId/logs",
  asyncHandler(async (req, res) => {
    await loadTaskForAccess(req.user, req.params.taskId);
    const logs = await listTaskLogs(req.params.taskId);
    return sendSuccess(res, logs);
  }),
);

router.post(
  "/tasks/:taskId/logs",
  authorize("can_edit_task"),
  asyncHandler(async (req, res) => {
    const body = req.body || {};
    await loadTaskForAccess(req.user, req.params.taskId);

    const stepName = String(body.step_name || body.action || "").trim();
    const stepStatus = String(body.status || "").trim() || "recorded";

    if (!stepName) {
      throw new AppError(400, "step_name is required");
    }

    await addTaskLog(req.params.taskId, {
      updatedBy: req.user.employee_id,
      stepName,
      status: stepStatus,
      notes: typeof body.notes === "string" ? body.notes.trim() || null : null,
    });
    await appendTaskActivity(req.params.taskId, {
      userEmployeeId: req.user.employee_id,
      actionType: "task_log_added",
      notes: typeof body.notes === "string" ? body.notes.trim() || null : null,
      metadata: { step_name: stepName, status: stepStatus },
    });
    return sendSuccess(res, { success: true });
  }),
);

router.get(
  "/tasks/:taskId/checklists",
  asyncHandler(async (req, res) => {
    await loadTaskForAccess(req.user, req.params.taskId);
    const checklists = await listTaskChecklists(req.params.taskId);
    return sendSuccess(res, checklists);
  }),
);

router.post(
  "/tasks/:taskId/checklists",
  authorize("can_edit_task"),
  asyncHandler(async (req, res) => {
    const body = req.body || {};
    await loadTaskForAccess(req.user, req.params.taskId);

    const item = String(body.item || "").trim();

    if (!item) {
      throw new AppError(400, "item is required");
    }

    await addTaskChecklist(req.params.taskId, {
      item,
      is_completed: body.is_completed === true,
      completed_by: body.is_completed === true ? req.user.employee_id : null,
      completed_at: body.is_completed === true ? new Date() : null,
    });
    await appendTaskActivity(req.params.taskId, {
      userEmployeeId: req.user.employee_id,
      actionType: "task_checklist_item_added",
      metadata: { item, is_completed: body.is_completed === true },
    });
    return sendSuccess(res, { success: true }, 201);
  }),
);

async function updateChecklistItem(req, res) {
  const body = req.body || {};
  await loadTaskForAccess(req.user, req.params.taskId);

  const payload = {};

  if (Object.prototype.hasOwnProperty.call(body, "item")) {
    const item = String(body.item || "").trim();
    if (!item) {
      throw new AppError(400, "item cannot be empty");
    }
    payload.item = item;
  }

  if (Object.prototype.hasOwnProperty.call(body, "is_completed")) {
    payload.is_completed = body.is_completed === true;
    payload.completed_by = body.is_completed === true ? req.user.employee_id : null;
    payload.completed_at = body.is_completed === true ? new Date() : null;
  }

  if (Object.keys(payload).length === 0) {
    throw new AppError(400, "No checklist changes provided");
  }

  const updatedChecklistId = await updateTaskChecklist(req.params.taskId, req.params.checklistId, payload);

  if (!updatedChecklistId) {
    throw new AppError(404, "Checklist item not found");
  }

  await appendTaskActivity(req.params.taskId, {
    userEmployeeId: req.user.employee_id,
    actionType: "task_checklist_updated",
    metadata: {
      checklist_id: req.params.checklistId,
      has_item_update: Object.prototype.hasOwnProperty.call(payload, "item"),
      is_completed: payload.is_completed,
    },
  });

  return sendSuccess(res, { success: true });
}

router.patch(
  "/tasks/:taskId/checklists/:checklistId",
  authorize("can_edit_task"),
  asyncHandler(updateChecklistItem),
);

router.put(
  "/tasks/:taskId/checklists/:checklistId",
  authorize("can_edit_task"),
  asyncHandler(updateChecklistItem),
);

router.delete(
  "/tasks/:taskId/checklists/:checklistId",
  authorize("can_edit_task"),
  asyncHandler(async (req, res) => {
    await loadTaskForAccess(req.user, req.params.taskId);

    const deletedChecklistId = await deleteTaskChecklist(req.params.taskId, req.params.checklistId);

    if (!deletedChecklistId) {
      throw new AppError(404, "Checklist item not found");
    }

    await appendTaskActivity(req.params.taskId, {
      userEmployeeId: req.user.employee_id,
      actionType: "task_checklist_deleted",
      metadata: { checklist_id: req.params.checklistId },
    });
    return sendSuccess(res, { success: true });
  }),
);

router.get(
  "/tasks/:taskId/attachments",
  asyncHandler(async (req, res) => {
    await loadTaskForAccess(req.user, req.params.taskId);
    const attachments = await listTaskAttachments(req.params.taskId);
    return sendSuccess(res, attachments);
  }),
);

router.post(
  "/tasks/:taskId/attachments",
  authorize("can_upload_proofs"),
  handleTaskProofUpload,
  asyncHandler(async (req, res) => {
    const task = await loadTaskForAccess(req.user, req.params.taskId);

    if (!req.file) {
      throw new AppError(400, "No image file uploaded");
    }

    const fileUrl = buildTaskProofFileUrl(req.file.filename);
    const originalFileName = sanitizeOriginalFileName(req.file.originalname);

    let attachment = null;

    try {
      ensureTaskProofUpdateAllowed(req.user, task);

      attachment = await addTaskAttachment(req.params.taskId, {
        file_url: fileUrl,
        file_path: req.file.path,
        file_name: originalFileName,
        mime_type: req.file.mimetype,
        file_size: req.file.size,
        uploaded_by: req.user.employee_id,
      });

      await updateTaskForUser(req.user, task.id, {
        proof_url: fileUrl,
        proof_type: "image",
        proof_name: originalFileName,
        proof_mime: req.file.mimetype,
        proof_size: req.file.size,
      });

      return sendSuccess(res, {
        success: true,
        attachment,
        max_file_size_mb: TASK_PROOF_MAX_SIZE_MB,
      }, 201);
    } catch (error) {
      if (attachment?.id) {
        await deleteTaskAttachment(req.params.taskId, attachment.id).catch(() => undefined);
      }
      await removeStoredTaskProof(req.file.path).catch(() => undefined);
      throw error;
    }
  }),
);

router.delete(
  "/tasks/:taskId/attachments/:attachmentId",
  authorize("can_edit_task"),
  asyncHandler(async (req, res) => {
    const task = await loadTaskForAccess(req.user, req.params.taskId);
    ensureTaskProofUpdateAllowed(req.user, task);

    const deletedAttachment = await deleteTaskAttachment(req.params.taskId, req.params.attachmentId);

    if (!deletedAttachment) {
      throw new AppError(404, "Attachment not found");
    }

    await removeStoredTaskProof(deletedAttachment.file_path).catch((error) => {
      console.warn("Could not remove task proof file:", error);
    });

    await appendTaskActivity(req.params.taskId, {
      userEmployeeId: req.user.employee_id,
      actionType: "task_attachment_deleted",
      metadata: { attachment_id: req.params.attachmentId },
    });
    return sendSuccess(res, { success: true });
  }),
);

module.exports = {
  taskRoutes: router,
};
