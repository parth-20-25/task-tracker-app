const { ROLE_DEFAULT_PERMISSIONS } = require("../config/constants");
const { pool } = require("../db");
const { AppError } = require("../lib/AppError");
const { parsePermissions } = require("./mappers");
const { assignPermissionsToRole, normalizePermissionIds } = require("./permissionRepository");

function buildPermissionMap(permissionIds = []) {
  return normalizePermissionIds(permissionIds).reduce((permissionMap, permissionId) => {
    permissionMap[permissionId] = true;
    return permissionMap;
  }, {});
}

function getEnabledPermissionIds(permissions = {}, roleId = null) {
  const parsedPermissions = permissions && typeof permissions === "object" ? permissions : {};

  if (parsedPermissions.all === true) {
    return normalizePermissionIds(ROLE_DEFAULT_PERMISSIONS[roleId] || []);
  }

  return normalizePermissionIds(
    Object.entries(parsedPermissions)
      .filter(([, enabled]) => enabled === true)
      .map(([permission]) => permission),
  );
}

function normalizeRolePermissions(permissions = {}, roleId = null) {
  return buildPermissionMap(getEnabledPermissionIds(permissions, roleId));
}

async function listRoles(client = pool) {
  const result = await client.query(`
    SELECT
      r.id,
      r.name,
      r.hierarchy_level,
      r.permissions,
      r.scope,
      r.parent_role,
      COALESCE(r.is_active, TRUE) AS is_active,
      COALESCE(
        array_agg(rp.permission_id) FILTER (WHERE rp.permission_id IS NOT NULL),
        ARRAY[]::text[]
      ) AS role_permission_ids
    FROM roles r
    LEFT JOIN role_permissions rp ON rp.role_id = r.id
    GROUP BY r.id, r.name, r.hierarchy_level, r.permissions, r.scope, r.parent_role, r.is_active
    ORDER BY COALESCE(r.is_active, TRUE) DESC, r.hierarchy_level, r.id
  `);

  return result.rows.map((row) => ({
    id: row.id,
    name: row.name,
    hierarchy_level: row.hierarchy_level,
    permissions: buildRolePermissionMap(row.permissions, row.role_permission_ids, row.id),
    scope: row.scope,
    parent_role: row.parent_role,
    is_active: row.is_active !== false,
  }));
}

function buildRolePermissionMap(storedPermissionsValue, relationalPermissionIds = [], roleId = null) {
  const storedPermissions = parsePermissions(storedPermissionsValue);
  const directPermissionIds = Object.entries(storedPermissions)
    .filter(([permissionId, enabled]) => enabled === true && typeof permissionId === "string" && permissionId.startsWith("can_"))
    .map(([permissionId]) => permissionId);
  const defaultPermissionIds = storedPermissions.all === true
    ? ROLE_DEFAULT_PERMISSIONS[roleId] || []
    : [];
  const normalizedPermissionIds = normalizePermissionIds([
    ...relationalPermissionIds,
    ...defaultPermissionIds,
    ...directPermissionIds,
  ]);

  return buildPermissionMap(normalizedPermissionIds);
}

async function upsertRole(role, client = pool) {
  const ownsConnection = typeof client.release !== "function";
  const dbClient = ownsConnection ? await client.connect() : client;

  try {
    if (ownsConnection) {
      await dbClient.query("BEGIN");
    }

    const normalizedPermissions = normalizeRolePermissions(role.permissions, role.id);

    await dbClient.query(
      `
        INSERT INTO roles (id, name, hierarchy_level, permissions, scope, parent_role, is_active)
        VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7)
        ON CONFLICT (id) DO UPDATE
        SET name = EXCLUDED.name,
            hierarchy_level = EXCLUDED.hierarchy_level,
            permissions = EXCLUDED.permissions,
            scope = EXCLUDED.scope,
            parent_role = EXCLUDED.parent_role,
            is_active = EXCLUDED.is_active
      `,
      [
        role.id,
        role.name,
        role.hierarchy_level,
        JSON.stringify(normalizedPermissions),
        role.scope,
        role.parent_role || null,
        role.is_active !== false,
      ],
    );

    await dbClient.query(`DELETE FROM role_permissions WHERE role_id = $1`, [role.id]);

    const permissionIds = getEnabledPermissionIds(normalizedPermissions, role.id);
    await assignPermissionsToRole(role.id, permissionIds, dbClient, {
      actorEmployeeId: role.auditActorEmployeeId,
      autoCreateMissingPermissions: role.autoCreateMissingPermissions,
      source: "rolesRepository.upsertRole",
    });

    const roles = await listRoles(dbClient);

    if (ownsConnection) {
      await dbClient.query("COMMIT");
    }

    return roles;
  } catch (error) {
    if (ownsConnection) {
      await dbClient.query("ROLLBACK");
    }

    throw error;
  } finally {
    if (ownsConnection) {
      dbClient.release();
    }
  }
}

async function deleteRole(roleId, client = pool) {
  const existingRole = await client.query(`SELECT id FROM roles WHERE id = $1 LIMIT 1`, [roleId]);
  if (existingRole.rowCount === 0) {
    throw new AppError(404, "Role not found");
  }

  const userCount = await client.query(`SELECT COUNT(*)::int AS count FROM users WHERE role = $1`, [roleId]);
  if (Number(userCount.rows[0].count) > 0) {
    throw new AppError(409, "Cannot deactivate role: it is assigned to existing users");
  }

  await client.query(`UPDATE roles SET is_active = FALSE WHERE id = $1`, [roleId]);
  return true;
}

module.exports = {
  deleteRole,
  listRoles,
  upsertRole,
};
