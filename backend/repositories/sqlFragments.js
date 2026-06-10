function sqlLiteral(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function trimmedTextSql(expression) {
  return `NULLIF(BTRIM((${expression})::text), '')`;
}

function numericIdentifierSql(expression) {
  return `NULLIF(REGEXP_REPLACE(${trimmedTextSql(expression)}, '^0+', ''), '')`;
}

function numericIdentifierPredicateSql(expression) {
  return `${trimmedTextSql(expression)} ~ '^[0-9]+$'`;
}

function userIdentifierMatchSql(userAlias, identifierExpression) {
  const identifier = trimmedTextSql(identifierExpression);

  return `(
    ${identifier} IS NOT NULL
    AND (
      ${userAlias}.employee_id = ${identifier}
      OR ${userAlias}.id::text = ${identifier}
      OR LOWER(${userAlias}.email) = LOWER(${identifier})
      OR (
        ${numericIdentifierPredicateSql(`${userAlias}.employee_id`)}
        AND ${numericIdentifierPredicateSql(identifierExpression)}
        AND ${numericIdentifierSql(`${userAlias}.employee_id`)} = ${numericIdentifierSql(identifierExpression)}
      )
    )
  )`;
}

function visibleUserIdentifierMatchSql(identifierExpression, visibleUserAlias = "visible_user") {
  const identifier = trimmedTextSql(identifierExpression);

  return `(
    ${identifier} IS NOT NULL
    AND (
      ${visibleUserAlias}.employee_id = ${identifier}
      OR ${visibleUserAlias}.user_uuid = ${identifier}
      OR (
        ${numericIdentifierPredicateSql(`${visibleUserAlias}.employee_id`)}
        AND ${numericIdentifierPredicateSql(identifierExpression)}
        AND ${numericIdentifierSql(`${visibleUserAlias}.employee_id`)} = ${numericIdentifierSql(identifierExpression)}
      )
    )
  )`;
}

function userResolutionLateralSql(alias, candidates) {
  const candidateRows = candidates
    .map((candidate, index) => {
      const priority = Number.isFinite(Number(candidate.priority)) ? Number(candidate.priority) : index + 1;
      return `(${priority}, (${candidate.expression})::text, ${sqlLiteral(candidate.source || `candidate_${priority}`)})`;
    })
    .join(",\n          ");

  return `
      LEFT JOIN LATERAL (
        SELECT
          matched_user.employee_id,
          matched_user.name,
          matched_user.is_active,
          candidate.identifier AS matched_identifier,
          candidate.source AS matched_source
        FROM (
          VALUES
          ${candidateRows}
        ) AS candidate(priority, identifier, source)
        JOIN users matched_user
          ON ${userIdentifierMatchSql("matched_user", "candidate.identifier")}
        ORDER BY candidate.priority ASC
        LIMIT 1
      ) ${alias} ON TRUE
  `;
}

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
  sqlLiteral,
  trimmedTextSql,
  userIdentifierMatchSql,
  userResolutionLateralSql,
  visibleUserIdentifierMatchSql,
};
