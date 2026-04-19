const { AppError } = require("../lib/AppError");
const { hasPermission } = require("../services/accessControlService");

/**
 * Middleware to enforce permission-based access control.
 * Usage: app.use(requirePermission("can_view_all_tasks"))
 * or router.get("/endpoint", requirePermission("permission_id"), handler)
 */
function requirePermission(requiredPermission) {
  return (req, _res, next) => {
    if (!req.user) {
      return next(new AppError(401, "Authentication required"));
    }

    if (!hasPermission(req.user, requiredPermission)) {
      return next(new AppError(403, `Permission denied: ${requiredPermission} required`));
    }

    return next();
  };
}

/**
 * Middleware to enforce multiple permissions (any one is sufficient).
 * Usage: router.get("/endpoint", requireAnyPermission(["perm1", "perm2"]), handler)
 */
function requireAnyPermission(permissions) {
  return (req, _res, next) => {
    if (!req.user) {
      return next(new AppError(401, "Authentication required"));
    }

    const hasAny = permissions.some((perm) => hasPermission(req.user, perm));
    if (!hasAny) {
      return next(new AppError(403, `Permission denied: one of [${permissions.join(", ")}] required`));
    }

    return next();
  };
}

/**
 * Middleware to enforce all permissions (all are required).
 * Usage: router.get("/endpoint", requireAllPermissions(["perm1", "perm2"]), handler)
 */
function requireAllPermissions(permissions) {
  return (req, _res, next) => {
    if (!req.user) {
      return next(new AppError(401, "Authentication required"));
    }

    const hasAll = permissions.every((perm) => hasPermission(req.user, perm));
    if (!hasAll) {
      return next(new AppError(403, `Permission denied: all of [${permissions.join(", ")}] required`));
    }

    return next();
  };
}

module.exports = {
  requirePermission,
  requireAnyPermission,
  requireAllPermissions,
};
