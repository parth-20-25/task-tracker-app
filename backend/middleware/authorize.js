const { pool } = require("../db");
const { AppError } = require("../lib/AppError");
const { hasPermission, isAdmin } = require("../services/accessControlService");
const { normalizePermissionIds } = require("../repositories/permissionRepository");

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

      // Check if the user has the required permission
      if (hasPermission(req.user, requiredPermission)) {
        return next();
      }

      // Special handling for admin role if applicable
      if (isAdmin(req.user)) {
        return next();
      }

      return next(new AppError(403, `Forbidden: You do not have the required permission "${requiredPermission}"`));
    } catch (error) {
      console.error("Authorization Error:", error);
      return next(new AppError(500, "Internal Server Error during authorization"));
    }
  };
}

module.exports = {
  requireAdmin,
  authorize,
  loadPermissions,
};
