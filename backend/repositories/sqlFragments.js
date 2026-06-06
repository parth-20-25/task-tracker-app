function buildUserColumns({ userAlias, roleAlias, departmentAlias, subdivisionAlias = "subdivision", prefix = "" }) {
  return `
    ${userAlias}.id AS ${prefix}id,
    ${userAlias}.employee_id AS ${prefix}employee_id,
    ${userAlias}.name AS ${prefix}name,
    ${userAlias}.email AS ${prefix}email,
    ${userAlias}.username AS ${prefix}username,
    ${userAlias}.username_changed_at AS ${prefix}username_changed_at,
    ${userAlias}.bio AS ${prefix}bio,
    ${userAlias}.avatar_bucket AS ${prefix}avatar_bucket,
    ${userAlias}.avatar_path AS ${prefix}avatar_path,
    ${userAlias}.avatar_updated_at AS ${prefix}avatar_updated_at,
    ${userAlias}.role AS ${prefix}role,
    ${userAlias}.parent_id AS ${prefix}parent_id,
    ${userAlias}.department_id AS ${prefix}department_id,
    ${userAlias}.subdivision_id AS ${prefix}subdivision_id,
    COALESCE(${userAlias}.is_active, TRUE) AS ${prefix}is_active,
    ${userAlias}.created_at AS ${prefix}created_at,
    ${roleAlias}.id AS ${prefix}role_id,
    ${roleAlias}.name AS ${prefix}role_name,
    ${roleAlias}.hierarchy_level AS ${prefix}role_hierarchy_level,
    ${roleAlias}.permissions AS ${prefix}role_permissions,
    ${roleAlias}.scope AS ${prefix}role_scope,
    ${roleAlias}.parent_role AS ${prefix}role_parent_role,
    ${departmentAlias}.id AS ${prefix}department_record_id,
    ${departmentAlias}.name AS ${prefix}department_name,
    ${departmentAlias}.parent_department AS ${prefix}department_parent_department,
    ${subdivisionAlias}.id AS ${prefix}subdivision_record_id,
    ${subdivisionAlias}.subdivision_name AS ${prefix}subdivision_name,
    COALESCE(${subdivisionAlias}.is_active, TRUE) AS ${prefix}subdivision_is_active
  `;
}

module.exports = {
  buildUserColumns,
};
