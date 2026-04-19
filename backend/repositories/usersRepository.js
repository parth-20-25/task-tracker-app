const { pool } = require("../db");
const { AppError } = require("../lib/AppError");
const { mapUserRow } = require("./mappers");
const { buildUserColumns } = require("./sqlFragments");

const ACTIVE_TASK_STATUSES = ["created", "assigned", "in_progress", "on_hold", "under_review", "rework"];

async function findAuthRecordByEmployeeId(employeeId, client = pool) {
  const result = await client.query(
    `
      SELECT employee_id, password_hash
      FROM users
      WHERE employee_id = $1
      LIMIT 1
    `,
    [employeeId],
  );

  return result.rows[0] || null;
}

async function findUserByEmployeeId(employeeId, client = pool) {
  const result = await client.query(
    `
      SELECT
        ${buildUserColumns({ userAlias: "u", roleAlias: "r", departmentAlias: "d" })}
      FROM users u
      LEFT JOIN roles r ON r.id = u.role
      LEFT JOIN departments d ON d.id = u.department_id
      WHERE u.employee_id = $1
      LIMIT 1
    `,
    [employeeId],
  );

  if (result.rows.length === 0) {
    return null;
  }

  return mapUserRow(result.rows[0]);
}

async function listUsers(client = pool) {
  const result = await client.query(
    `
      SELECT
        ${buildUserColumns({ userAlias: "u", roleAlias: "r", departmentAlias: "d" })}
      FROM users u
      LEFT JOIN roles r ON r.id = u.role
      LEFT JOIN departments d ON d.id = u.department_id
      ORDER BY u.employee_id
    `,
  );

  return result.rows.map((row) => mapUserRow(row));
}

async function listUsersByRoleAndDepartment(roleId, departmentId, client = pool) {
  const result = await client.query(
    `
      SELECT
        ${buildUserColumns({ userAlias: "u", roleAlias: "r", departmentAlias: "d" })}
      FROM users u
      LEFT JOIN roles r ON r.id = u.role
      LEFT JOIN departments d ON d.id = u.department_id
      WHERE u.role = $1
        AND (
          u.department_id = $2
          OR $2 IS NULL
        )
      ORDER BY u.employee_id
    `,
    [roleId, departmentId || null],
  );

  return result.rows.map((row) => mapUserRow(row));
}

async function createUser(user, client = pool) {
  try {
    await client.query(
      `
        INSERT INTO users (
          name,
          employee_id,
          email,
          role,
          department_id,
          password_hash,
          is_active,
          created_at,
          updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())
      `,
      [
        user.name,
        user.employee_id,
        user.email || null,
        user.role,
        user.department_id || null,
        user.password_hash,
        user.is_active,
      ],
    );
  } catch (error) {
    if (error.code === "23505") {
      throw new AppError(409, "Employee ID already exists");
    }

    throw error;
  }

  return findUserByEmployeeId(user.employee_id, client);
}

async function updateUser(employeeId, user, client = pool) {
  const result = await client.query(
    `
      UPDATE users
      SET name = $2,
          role = $3,
          department_id = $4,
          is_active = $5,
          updated_at = NOW()
      WHERE employee_id = $1
      RETURNING employee_id
    `,
    [
      employeeId,
      user.name,
      user.role,
      user.department_id || null,
      user.is_active,
    ],
  );

  if (result.rowCount === 0) {
    throw new AppError(404, "User not found");
  }

  return findUserByEmployeeId(employeeId, client);
}

async function getActiveTaskDependencies(employeeId, client = pool) {
  const result = await client.query(
    `
      SELECT
        COUNT(*)::int AS total_active_tasks,
        COUNT(*) FILTER (
          WHERE assigned_to = $1
             OR COALESCE(assignee_ids, '[]'::jsonb) ? $1
        )::int AS assigned_tasks,
        COUNT(*) FILTER (
          WHERE assigned_by = $1
        )::int AS created_tasks
      FROM tasks
      WHERE status = ANY($2::text[])
        AND (
          assigned_to = $1
          OR assigned_by = $1
          OR COALESCE(assignee_ids, '[]'::jsonb) ? $1
        )
    `,
    [employeeId, ACTIVE_TASK_STATUSES],
  );

  return result.rows[0] || {
    total_active_tasks: 0,
    assigned_tasks: 0,
    created_tasks: 0,
  };
}

async function setUserActiveStatus(employeeId, isActive, client = pool) {
  await client.query(
    `UPDATE users SET is_active = $2, updated_at = NOW() WHERE employee_id = $1`,
    [employeeId, isActive],
  );

  return findUserByEmployeeId(employeeId, client);
}

async function deleteUser(employeeId, client = pool) {
  const dependencies = await getActiveTaskDependencies(employeeId, client);

  if (Number(dependencies.total_active_tasks) > 0) {
    throw new AppError(
      409,
      "Cannot delete user while active tasks still reference them. Reassign the tasks or deactivate the user instead.",
      {
        total_active_tasks: Number(dependencies.total_active_tasks),
        assigned_tasks: Number(dependencies.assigned_tasks),
        created_tasks: Number(dependencies.created_tasks),
      },
    );
  }

  const result = await client.query(`DELETE FROM users WHERE employee_id = $1`, [employeeId]);

  if (result.rowCount === 0) {
    throw new AppError(404, "User not found");
  }

  return true;
}

module.exports = {
  createUser,
  deleteUser,
  findAuthRecordByEmployeeId,
  findUserByEmployeeId,
  getActiveTaskDependencies,
  listUsers,
  listUsersByRoleAndDepartment,
  setUserActiveStatus,
  updateUser,
};
