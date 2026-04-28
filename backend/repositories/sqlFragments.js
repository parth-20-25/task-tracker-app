function buildUserColumns({ userAlias, roleAlias, departmentAlias, prefix = "" }) {
  return `
    ${userAlias}.employee_id AS ${prefix}employee_id,
    ${userAlias}.name AS ${prefix}name,
    ${userAlias}.email AS ${prefix}email,
    ${userAlias}.role AS ${prefix}role,
    ${userAlias}.department_id AS ${prefix}department_id,
    ${userAlias}.parent_id AS ${prefix}parent_id,
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
    ${departmentAlias}.parent_department AS ${prefix}department_parent_department
  `;
}

module.exports = {
  buildUserColumns,
};
