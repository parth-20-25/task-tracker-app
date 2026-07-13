const { pool } = require("../db");
const { AppError } = require("../lib/AppError");
const {
  HasPermission,
  canViewProjectFixtures,
  isAdmin,
  isExecutiveDashboardRole,
  isOperationalControllerRole,
  isProjectAuthorityRole,
} = require("../services/accessControlService");
const { PERMISSIONS } = require("../config/constants");
const { normalizePermissionIds } = require("../repositories/permissionRepository");

const PROJECT_AUTHORITY_PERMISSIONS = new Set([
  PERMISSIONS.VIEW_REPORTS,
  PERMISSIONS.EXPORT_REPORTS,
]);

function normalizeRoleId(role) {
  if (!role) {
    return null;
  }

  return typeof role === "string" ? role : role.id || null;
}

/**
 * Load permissions for a given role from the database.
 */
async function loadPermissions(role) {
  const roleId = normalizeRoleId(role);

  if (!roleId) {
    return [];
  }

  try {
    const result = await pool.query(
      "SELECT permission_id FROM role_permissions WHERE role_id = $1",
      [roleId]
    );
    const relationalPermissions = result.rows.map((row) => row.permission_id);
    const roleFlags = typeof role === "object" && role?.permissions && typeof role.permissions === "object"
      ? Object.entries(role.permissions)
        .filter(([, enabled]) => enabled === true)
        .map(([permission]) => permission)
      : [];

    return normalizePermissionIds([...relationalPermissions, ...roleFlags]);
  } catch (error) {
    console.error("Error loading permissions:", error);
    return [];
  }
}

/**
 * Legacy Admin check
 */
function requireAdmin(req, _res, next) {
  if (!isAdmin(req.user)) {
    return next(new AppError(403, "Admin access required"));
  }
  return next();
}

function requireOperationalController(req, _res, next) {
  if (!req.user) {
    return next(new AppError(401, "Unauthorized: User not authenticated"));
  }

  if (!isOperationalControllerRole(req.user)) {
    return next(new AppError(403, "Project fixture controls are limited to operational controllers"));
  }

  return next();
}

function requireProjectFixtureViewer(req, _res, next) {
  if (!req.user) {
    return next(new AppError(401, "Unauthorized: User not authenticated"));
  }

  if (!canViewProjectFixtures(req.user)) {
    return next(new AppError(403, "Project fixture access requires an operational controller or assigned Design 2D viewer"));
  }

  return next();
}

function requireExecutiveDashboardAccess(req, _res, next) {
  if (!req.user) {
    return next(new AppError(401, "Unauthorized: User not authenticated"));
  }

  if (!isExecutiveDashboardRole(req.user)) {
    return next(new AppError(403, "Executive dashboard access requires Admin, CEO, or Director role"));
  }

  return next();
}

/**
 * Middleware to enforce specific permissions.
 * Usage: router.get('/endpoint', authenticate, authorize('can_view_all_tasks'), handler)
 */
function authorize(requiredPermission) {
  return async (req, res, next) => {
    try {
      if (!req.user) {
        return next(new AppError(401, "Unauthorized: User not authenticated"));
      }

      // Load permissions if not already loaded
      if (!req.user.permissions) {
        req.user.permissions = await loadPermissions(req.user.role);
      }

      // Check if the user has the required permission.
      // req.user is rebuilt from the database per request, so role-permission changes
      // do not depend on stale JWT claims.
      const permissionGranted = await HasPermission(req.user, requiredPermission);
      const role = typeof req.user.role === "object" ? req.user.role : req.user.role_details;
      const currentRole = role?.id || req.user.role_id || req.user.role || null;
      const resolvedPermissions = Array.isArray(req.user.permissions) ? req.user.permissions : [];

      console.info("[authorization]", {
        event: "permission_check",
        current_user_id: req.user.id || null,
        current_employee_id: req.user.employee_id || null,
        current_role: currentRole,
        current_role_name: role?.name || null,
        resolved_permissions: resolvedPermissions,
        required_permission: requiredPermission,
        permission_result: permissionGranted,
        path: req.originalUrl || req.url,
        method: req.method,
      });

      if (permissionGranted) {
        return next();
      }

      if (PROJECT_AUTHORITY_PERMISSIONS.has(requiredPermission) && isProjectAuthorityRole(req.user)) {
        return next();
      }

      // Special handling for admin role if applicable
      if (isAdmin(req.user)) {
        return next();
      }

      console.warn("[authorization]", {
        event: "permission_rejected",
        current_user_id: req.user.id || null,
        current_employee_id: req.user.employee_id || null,
        current_role: currentRole,
        required_permission: requiredPermission,
        permission_result: false,
        reject_reason: "missing_required_permission",
        path: req.originalUrl || req.url,
        method: req.method,
      });

      return next(new AppError(403, `Forbidden: You do not have the required permission "${requiredPermission}"`));
    } catch (error) {
      console.error("Authorization Error:", error);
      return next(new AppError(500, "Internal Server Error during authorization"));
    }
  };
}

module.exports = {
  requireAdmin,
  requireExecutiveDashboardAccess,
  requireOperationalController,
  requireProjectFixtureViewer,
  authorize,
  loadPermissions,
};
