const express = require("express");
const { asyncHandler } = require("../lib/asyncHandler");
const { sendSuccess } = require("../lib/response");
const { authenticate } = require("../middleware/authenticate");
const { handleControlWorkflowProofUpload } = require("../lib/controlWorkflowProofUpload");
const controlWorkflowService = require("../services/controlWorkflowService");

const router = express.Router();

router.use(authenticate);

router.get(
  "/control/sub-departments",
  asyncHandler(async (req, res) => sendSuccess(res, await controlWorkflowService.listControlSubDepartments(req.user))),
);

router.get(
  "/control/workflow-templates/by-sub-department/:subDepartmentId",
  asyncHandler(async (req, res) => sendSuccess(
    res,
    await controlWorkflowService.getWorkflowTemplateBySubDepartment(req.user, req.params.subDepartmentId),
  )),
);

router.get(
  "/control/design/capabilities",
  asyncHandler(async (req, res) => sendSuccess(res, await controlWorkflowService.getControlDesignCapabilities(req.user))),
);

router.get(
  "/control/design/summary",
  asyncHandler(async (req, res) => sendSuccess(res, await controlWorkflowService.getControlDesignSummary(req.user))),
);
router.get(
  "/control/design/projects",
  asyncHandler(async (req, res) => sendSuccess(res, await controlWorkflowService.listControlDesignProjects(req.user))),
);

router.post(
  "/control/design/projects",
  asyncHandler(async (req, res) => sendSuccess(res, await controlWorkflowService.createControlDesignProject(req.user, req.body), 201)),
);

router.get(
  "/control/design/assignees",
  asyncHandler(async (req, res) => sendSuccess(res, await controlWorkflowService.listControlDesignAssignableUsers(req.user))),
);

router.post(
  "/control/design/co",
  asyncHandler(async (req, res) => sendSuccess(res, await controlWorkflowService.createControlDesignCo(req.user, req.body), 201)),
);

router.post(
  "/control/design/projects/:projectId/assign",
  asyncHandler(async (req, res) => sendSuccess(
    res,
    await controlWorkflowService.assignControlDesignProjectOwner(
      req.user,
      req.params.projectId,
      req.body?.assigned_user_id,
      req.body?.reason || req.body?.reassignment_reason,
    ),
  )),
);
router.get(
  "/control/workflows/approvals/pending",
  asyncHandler(async (req, res) => sendSuccess(res, await controlWorkflowService.listPendingApprovals(req.user))),
);

router.get(
  "/control/workflows/revisions/required",
  asyncHandler(async (req, res) => sendSuccess(res, await controlWorkflowService.listRevisionQueue(req.user))),
);

router.get(
  "/control/workflows/project/:projectId",
  asyncHandler(async (req, res) => sendSuccess(
    res,
    await controlWorkflowService.getProjectWorkflow(req.user, {
      project_id: req.params.projectId,
      sub_department_id: req.query.sub_department_id,
      template_id: req.query.template_id,
    }),
  )),
);

router.post(
  "/control/workflows",
  asyncHandler(async (req, res) => sendSuccess(res, await controlWorkflowService.createProjectWorkflow(req.user, req.body), 201)),
);

router.patch(
  "/control/workflows/:workflowId/owner",
  asyncHandler(async (req, res) => sendSuccess(
    res,
    await controlWorkflowService.reassignProjectWorkflowOwner(
      req.user,
      req.params.workflowId,
      req.body?.assigned_user_id,
      req.body?.reason || req.body?.reassignment_reason,
    ),
  )),
);

router.post(
  "/control/workflow-stages/:stageId/start",
  asyncHandler(async (req, res) => sendSuccess(res, await controlWorkflowService.startStage(req.user, req.params.stageId, req.body))),
);

router.post(
  "/control/workflow-stages/:stageId/submit",
  asyncHandler(async (req, res) => sendSuccess(
    res,
    await controlWorkflowService.submitStageForApproval(req.user, req.params.stageId, req.body),
  )),
);

router.post(
  "/control/workflow-stages/:stageId/approve",
  asyncHandler(async (req, res) => sendSuccess(
    res,
    await controlWorkflowService.approveStageSubmission(req.user, req.params.stageId, req.body),
  )),
);

router.post(
  "/control/workflow-stages/:stageId/changes-required",
  asyncHandler(async (req, res) => sendSuccess(
    res,
    await controlWorkflowService.markStageRevisionRequired(req.user, req.params.stageId, req.body),
  )),
);
router.post(
  "/control/workflow-stages/:stageId/revision-required",
  asyncHandler(async (req, res) => sendSuccess(
    res,
    await controlWorkflowService.markStageRevisionRequired(req.user, req.params.stageId, req.body),
  )),
);

router.post(
  "/control/workflow-stages/:stageId/revisions",
  asyncHandler(async (req, res) => sendSuccess(
    res,
    await controlWorkflowService.raiseRevision(req.user, req.params.stageId, req.body),
    201,
  )),
);

router.patch(
  "/control/workflow-stages/:stageId/document-path",
  asyncHandler(async (req, res) => sendSuccess(
    res,
    await controlWorkflowService.updateDocumentPath(req.user, req.params.stageId, req.body),
  )),
);

router.post(
  "/control/workflow-stages/:stageId/proofs",
  handleControlWorkflowProofUpload,
  asyncHandler(async (req, res) => sendSuccess(
    res,
    await controlWorkflowService.uploadWorkflowProof(req.user, req.params.stageId, req.file, req.body),
    201,
  )),
);

router.delete(
  "/control/workflow-proofs/:proofId",
  asyncHandler(async (req, res) => sendSuccess(
    res,
    await controlWorkflowService.removeWorkflowProof(req.user, req.params.proofId),
  )),
);

router.get(
  "/control/workflow-proofs/:proofId",
  asyncHandler(async (req, res) => {
    const proof = await controlWorkflowService.getWorkflowProofFile(req.user, req.params.proofId);
    const disposition = req.query.download === "1" ? "attachment" : "inline";
    res.setHeader("Content-Type", proof.mime_type || "application/octet-stream");
    res.setHeader("Content-Disposition", `${disposition}; filename*=UTF-8''${encodeURIComponent(proof.original_filename)}`);
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    return res.sendFile(proof.file_path);
  }),
);
router.post(
  "/control/workflow-stages/:stageId/comments",
  asyncHandler(async (req, res) => sendSuccess(res, await controlWorkflowService.addStageComment(req.user, req.params.stageId, req.body), 201)),
);

router.post(
  "/control/workflow-stages/:stageId/pre-completed",
  asyncHandler(async (req, res) => sendSuccess(
    res,
    await controlWorkflowService.markStagePreCompleted(req.user, req.params.stageId, req.body),
  )),
);

router.post(
  "/control/workflow-stages/:stageId/override-unlock",
  asyncHandler(async (req, res) => sendSuccess(
    res,
    await controlWorkflowService.overrideUnlockStage(req.user, req.params.stageId, req.body),
  )),
);

router.post(
  "/control/workflow-stages/:stageId/skip-by-override",
  asyncHandler(async (req, res) => sendSuccess(
    res,
    await controlWorkflowService.skipStageByOverride(req.user, req.params.stageId, req.body),
  )),
);

router.post(
  "/control/workflows/:workflowId/dispatch",
  asyncHandler(async (req, res) => sendSuccess(
    res,
    await controlWorkflowService.markWorkflowDispatched(req.user, req.params.workflowId, req.body),
  )),
);

router.post(
  "/control/workflow-revisions/:revisionId/start",
  asyncHandler(async (req, res) => sendSuccess(res, await controlWorkflowService.startRevision(req.user, req.params.revisionId))),
);

router.post(
  "/control/workflow-revisions/:revisionId/submit",
  asyncHandler(async (req, res) => sendSuccess(
    res,
    await controlWorkflowService.submitRevisionForApproval(req.user, req.params.revisionId, req.body),
  )),
);

router.post(
  "/control/workflow-revisions/:revisionId/approve",
  asyncHandler(async (req, res) => sendSuccess(
    res,
    await controlWorkflowService.approveRevision(req.user, req.params.revisionId, req.body),
  )),
);

router.post(
  "/control/workflow-revisions/:revisionId/changes-required",
  asyncHandler(async (req, res) => sendSuccess(
    res,
    await controlWorkflowService.markRevisionChangesRequired(req.user, req.params.revisionId, req.body),
  )),
);

module.exports = {
  controlWorkflowRoutes: router,
};
