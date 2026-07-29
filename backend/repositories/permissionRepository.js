const { env } = require("../config/env");
const {
  DEPRECATED_PERMISSION_IDS,
  CONTROL_DESIGN_ROLE_PERMISSION_BUNDLES,
  PERMISSIONS,
  PERMISSION_DEFINITIONS,
} = require("../config/constants");
const { AppError } = require("../lib/AppError");

const permissionDefinitionMap = new Map(
  PERMISSION_DEFINITIONS.map(([id, name, description]) => [id, { id, name, description }]),
);
const LEGACY_PERMISSION_MIGRATIONS = {
  can_assign_task: "can_assign_tasks",
  can_verify_task: "approve_completed_task",
  can_upload_data: "upload_native_design_data",
  "control_design.create_projects": PERMISSIONS.CONTROL_DESIGN_PROJECTS_CREATE,
  "control_design.view_all_projects": PERMISSIONS.CONTROL_DESIGN_PROJECTS_VIEW_ALL,
  "control_design.assign_projects": PERMISSIONS.CONTROL_DESIGN_PROJECTS_ASSIGN,
  "control_design.reassign_projects": PERMISSIONS.CONTROL_DESIGN_PROJECTS_REASSIGN,
};
const STALE_PERMISSION_IDS = ["tasks_assign", ...Object.keys(LEGACY_PERMISSION_MIGRATIONS)];
const LEGACY_UPLOAD_COMPATIBILITY_ROLE_IDS = ["r1", "r2", "r3", "r4", "r5", "r6", "r7", "r8", "r9", "r10"];
const deprecatedPermissionIdSet = new Set(DEPRECATED_PERMISSION_IDS);

function normalizePermissionId(permissionId) {
  if (typeof permissionId !== "string") {
    return permissionId;
  }

  const trimmedPermissionId = permissionId.trim();
  return LEGACY_PERMISSION_MIGRATIONS[trimmedPermissionId] || trimmedPermissionId;
}

function normalizePermissionIds(permissionIds = []) {
  return [...new Set(
    permissionIds
      .map(normalizePermissionId)
      .filter((permissionId) => typeof permissionId === "string" && permissionId.length > 0),
  )];
}

function isGrantablePermissionId(permissionId) {
  return !deprecatedPermissionIdSet.has(normalizePermissionId(permissionId));
}

function normalizeGrantablePermissionIds(permissionIds = []) {
  return normalizePermissionIds(permissionIds).filter(isGrantablePermissionId);
}

function buildPermissionDefinition(permissionId) {
  const predefinedDefinition = permissionDefinitionMap.get(permissionId);

  if (predefinedDefinition) {
    return predefinedDefinition;
  }

  const label = permissionId
    .replace(/^can_/, "")
    .split("_")
    .filter(Boolean)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(" ");

  return {
    id: permissionId,
    name: label || permissionId,
    description: `Auto-created permission for ${permissionId}.`,
  };
}

async function seedPermissions(client) {
  for (const [id, name, description] of PERMISSION_DEFINITIONS) {
    await client.query(
      `
        INSERT INTO permissions (id, name, description)
        VALUES ($1, $2, $3)
        ON CONFLICT (id) DO UPDATE
        SET name = EXCLUDED.name,
            description = EXCLUDED.description,
            updated_at = NOW()
      `,
      [id, name, description],
    );
  }
}

async function ensurePermissionsExist(permissionIds, client, options = {}) {
  const normalizedPermissionIds = normalizePermissionIds(permissionIds);

  if (normalizedPermissionIds.length === 0) {
    return [];
  }

  const result = await client.query(
    `
      SELECT id
      FROM permissions
      WHERE id = ANY($1::text[])
    `,
    [normalizedPermissionIds],
  );

  const existingPermissionIds = new Set(result.rows.map((row) => row.id));
  const missingPermissionIds = normalizedPermissionIds.filter((permissionId) => !existingPermissionIds.has(permissionId));

  if (missingPermissionIds.length === 0) {
    return normalizedPermissionIds;
  }

  const autoCreateMissingPermissions = options.autoCreateMissingPermissions ?? env.rbac.autoCreatePermissions;
  const logContext = {
    source: options.source || "permission_validation",
    roleId: options.roleId || null,
    actorEmployeeId: options.actorEmployeeId || null,
    requestedPermissionIds: normalizedPermissionIds,
    missingPermissionIds,
  };

  if (!autoCreateMissingPermissions) {
    console.warn("[rbac] Invalid permission assignment rejected", logContext);
    throw new AppError(400, `Permission ${missingPermissionIds[0]} does not exist`, {
      invalidPermissions: missingPermissionIds,
    });
  }

  console.warn("[rbac] Auto-creating missing permissions", logContext);

  for (const permissionId of missingPermissionIds) {
    const definition = buildPermissionDefinition(permissionId);
    await client.query(
      `
        INSERT INTO permissions (id, name, description)
        VALUES ($1, $2, $3)
        ON CONFLICT (id) DO UPDATE
        SET name = EXCLUDED.name,
            description = EXCLUDED.description,
            updated_at = NOW()
      `,
      [definition.id, definition.name, definition.description],
    );
  }

  return normalizedPermissionIds;
}

async function assignPermissionsToRole(roleId, permissionIds, client, options = {}) {
  const validPermissionIds = await ensurePermissionsExist(normalizeGrantablePermissionIds(permissionIds), client, {
    ...options,
    roleId,
  });

  for (const permissionId of validPermissionIds) {
    await client.query(
      `
        INSERT INTO role_permissions (role_id, permission_id)
        VALUES ($1, $2)
        ON CONFLICT (role_id, permission_id) DO NOTHING
      `,
      [roleId, permissionId],
    );
  }

  return validPermissionIds;
}

async function syncNativeUploadPermissionFromLegacy(client) {
  await client.query(
    `
      INSERT INTO role_permissions (role_id, permission_id)
      SELECT role_id, $2
      FROM role_permissions
      WHERE permission_id = $1
      ON CONFLICT (role_id, permission_id) DO NOTHING
    `,
    [PERMISSIONS.UPLOAD_LEGACY_DESIGN_DATA, PERMISSIONS.UPLOAD_NATIVE_DESIGN_DATA],
  );

  await client.query(
    `
      INSERT INTO role_permissions (role_id, permission_id)
      SELECT id, $2
      FROM roles
      WHERE id = ANY($1::text[])
      ON CONFLICT (role_id, permission_id) DO NOTHING
    `,
    [LEGACY_UPLOAD_COMPATIBILITY_ROLE_IDS, PERMISSIONS.UPLOAD_NATIVE_DESIGN_DATA],
  );

  await client.query(
    `
      UPDATE roles
      SET permissions = CASE
        WHEN permissions ? $2 THEN permissions - $1
        WHEN permissions ? $1 THEN jsonb_set(permissions - $1, ARRAY[$2], 'true'::jsonb, true)
        ELSE permissions - $1
      END
      WHERE permissions ? $1
         OR permissions ? $2
    `,
    [PERMISSIONS.UPLOAD_LEGACY_DESIGN_DATA, PERMISSIONS.UPLOAD_NATIVE_DESIGN_DATA],
  );
}

async function syncControlDesignWorkspacePermissionForConfiguredRoles(client) {
  await client.query(
    `
      INSERT INTO role_permissions (role_id, permission_id)
      SELECT DISTINCT control_roles.role_id, $1
      FROM (
        SELECT role_id
        FROM role_permissions
        WHERE permission_id LIKE 'control_design.%'
          AND permission_id <> $1

        UNION

        SELECT roles.id AS role_id
        FROM roles
        CROSS JOIN LATERAL jsonb_each(COALESCE(roles.permissions, '{}'::jsonb)) AS permission(permission_id, enabled)
        WHERE permission.permission_id LIKE 'control_design.%'
          AND permission.permission_id <> $1
          AND permission.enabled = 'true'::jsonb
      ) control_roles
      ON CONFLICT (role_id, permission_id) DO NOTHING
    `,
    [PERMISSIONS.CONTROL_DESIGN_WORKSPACE_VIEW],
  );
}

async function syncControlDesignProjectPermissions(client) {
  for (const [roleId, permissionIds] of Object.entries(CONTROL_DESIGN_ROLE_PERMISSION_BUNDLES)) {
    await assignPermissionsToRole(roleId, permissionIds, client, {
      autoCreateMissingPermissions: true,
      source: "permissionRepository.syncControlDesignProjectPermissions",
    });
  }

  await syncControlDesignWorkspacePermissionForConfiguredRoles(client);
}

async function syncProjectScopePermissions(client) {
  await client.query(`
    INSERT INTO role_permissions (role_id, permission_id)
    SELECT role.id, $1
    FROM roles role
    WHERE LOWER(BTRIM(REGEXP_REPLACE(COALESCE(role.name, role.id), '[^[:alnum:]]+', '_', 'g'), '_'))
          IN ('ceo', 'director', 'director_ceo', 'ceo_director')
    ON CONFLICT (role_id, permission_id) DO NOTHING
  `, [PERMISSIONS.VIEW_PROJECT_SCOPE]);

  await client.query(`
    INSERT INTO role_permissions (role_id, permission_id)
    SELECT role.id, $1
    FROM roles role
    WHERE LOWER(BTRIM(REGEXP_REPLACE(COALESCE(role.name, role.id), '[^[:alnum:]]+', '_', 'g'), '_'))
          IN ('team_leader', 'line_manager', 'co_leader', 'team_co_leader', 'shift_incharge')
    ON CONFLICT (role_id, permission_id) DO NOTHING
  `, [PERMISSIONS.EDIT_PROJECT_PLANNED_TIME]);
}
async function syncRolePermissionJson(client) {
  await client.query(
    `
      UPDATE roles r
      SET permissions = COALESCE(permission_map.permissions, '{}'::jsonb)
      FROM (
        SELECT
          roles.id AS role_id,
          jsonb_object_agg(rp.permission_id, true ORDER BY rp.permission_id)
            FILTER (
              WHERE rp.permission_id IS NOT NULL
                AND NOT (rp.permission_id = ANY($1::text[]))
            ) AS permissions
        FROM roles
        LEFT JOIN role_permissions rp
          ON rp.role_id = roles.id
        GROUP BY roles.id
      ) permission_map
      WHERE permission_map.role_id = r.id
    `,
    [DEPRECATED_PERMISSION_IDS],
  );
}

async function alignPermissionData(client) {
  await seedPermissions(client);
  const canonicalPermissionMap = normalizePermissionIds(
    PERMISSION_DEFINITIONS
      .map(([permissionId]) => permissionId)
      .filter((permissionId) => permissionId !== PERMISSIONS.SELF_APPROVE)
      .filter(isGrantablePermissionId),
  ).reduce((permissionMap, permissionId) => {
    permissionMap[permissionId] = true;
    return permissionMap;
  }, {});

  await client.query(
    `
      UPDATE roles
      SET permissions = CASE
        WHEN permissions ->> 'all' = 'true' THEN $1::jsonb
        ELSE permissions - 'all'
      END
      WHERE permissions ? 'all'
    `,
    [JSON.stringify(canonicalPermissionMap)],
  );

  for (const [legacyPermissionId, canonicalPermissionId] of Object.entries(LEGACY_PERMISSION_MIGRATIONS)) {
    if (!legacyPermissionId || !canonicalPermissionId || legacyPermissionId === canonicalPermissionId) {
      continue;
    }

    const canonicalDefinition = buildPermissionDefinition(canonicalPermissionId);

    await client.query(
      `
        INSERT INTO permissions (id, name, description)
        VALUES ($1, $2, $3)
        ON CONFLICT (id) DO UPDATE
        SET name = EXCLUDED.name,
            description = EXCLUDED.description,
            updated_at = NOW()
      `,
      [canonicalDefinition.id, canonicalDefinition.name, canonicalDefinition.description],
    );

    await client.query(
      `
        INSERT INTO role_permissions (role_id, permission_id)
        SELECT role_id, $2
        FROM role_permissions
        WHERE permission_id = $1
        ON CONFLICT (role_id, permission_id) DO NOTHING
      `,
      [legacyPermissionId, canonicalPermissionId],
    );

    await client.query(`DELETE FROM role_permissions WHERE permission_id = $1`, [legacyPermissionId]);

    await client.query(
      `
        UPDATE workflow_transitions
        SET required_permission = $2,
            updated_at = NOW()
        WHERE required_permission = $1
      `,
      [legacyPermissionId, canonicalPermissionId],
    );

    await client.query(
      `
        UPDATE roles
        SET permissions = CASE
          WHEN permissions ? $1 AND permissions ? $2 THEN permissions - $1
          WHEN permissions ? $1 THEN jsonb_set(permissions - $1, ARRAY[$2], permissions -> $1, true)
          ELSE permissions
        END
        WHERE permissions ? $1
      `,
      [legacyPermissionId, canonicalPermissionId],
    );

    await client.query(
      `
        DELETE FROM permissions p
        WHERE p.id = $1
          AND NOT EXISTS (
            SELECT 1
            FROM role_permissions rp
            WHERE rp.permission_id = p.id
          )
          AND NOT EXISTS (
            SELECT 1
            FROM workflow_transitions wt
            WHERE wt.required_permission = p.id
          )
      `,
      [legacyPermissionId],
    );
  }

  await client.query(
    `
      DELETE FROM role_permissions rp
      WHERE NOT EXISTS (
        SELECT 1
        FROM permissions p
        WHERE p.id = rp.permission_id
      )
    `,
  );

  await client.query(
    `
      DELETE FROM permissions p
      WHERE p.id = ANY($1::text[])
        AND NOT EXISTS (
          SELECT 1
          FROM role_permissions rp
          WHERE rp.permission_id = p.id
        )
        AND NOT EXISTS (
          SELECT 1
          FROM workflow_transitions wt
          WHERE wt.required_permission = p.id
        )
    `,
    [STALE_PERMISSION_IDS],
  );

  await syncControlDesignProjectPermissions(client);
  await syncProjectScopePermissions(client);
  await syncNativeUploadPermissionFromLegacy(client);
  await syncRolePermissionJson(client);
}

module.exports = {
  alignPermissionData,
  assignPermissionsToRole,
  ensurePermissionsExist,
  isGrantablePermissionId,
  normalizePermissionId,
  normalizeGrantablePermissionIds,
  normalizePermissionIds,
  seedPermissions,
  syncProjectScopePermissions,
  syncControlDesignWorkspacePermissionForConfiguredRoles,
  syncNativeUploadPermissionFromLegacy,
};
