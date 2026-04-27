const express = require("express");
const { asyncHandler } = require("../lib/asyncHandler");
const { sendSuccess } = require("../lib/response");
const { authenticate } = require("../middleware/authenticate");
const {
  commentOnIssue,
  createIssueForUser,
  getIssueCommentsForUser,
  listAssignedIssues,
  listMyIssues,
  updateIssueStatusForUser,
} = require("../services/issueService");

const router = express.Router();

router.use(authenticate);

router.post(
  "/issues",
  asyncHandler(async (req, res) => {
    const result = await createIssueForUser(req.user, req.body);
    return sendSuccess(res, result, 201);
  }),
);

router.get(
  "/issues/my",
  asyncHandler(async (req, res) => {
    const issues = await listMyIssues(req.user);
    return sendSuccess(res, issues);
  }),
);

router.get(
  "/issues/assigned",
  asyncHandler(async (req, res) => {
    const issues = await listAssignedIssues(req.user);
    return sendSuccess(res, issues);
  }),
);

router.get(
  "/issues/:id/comments",
  asyncHandler(async (req, res) => {
    const comments = await getIssueCommentsForUser(req.user, req.params.id);
    return sendSuccess(res, comments);
  }),
);

router.post(
  "/issues/:id/comment",
  asyncHandler(async (req, res) => {
    const comment = await commentOnIssue(req.user, req.params.id, req.body);
    return sendSuccess(res, comment, 201);
  }),
);

router.patch(
  "/issues/:id/status",
  asyncHandler(async (req, res) => {
    const issue = await updateIssueStatusForUser(req.user, req.params.id, req.body);
    return sendSuccess(res, issue);
  }),
);

module.exports = {
  issueRoutes: router,
};
