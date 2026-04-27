const { tasks } = require("../seedData");

async function seedTasksIfNeeded(client) {
  if (process.env.ENABLE_TASK_SEED !== "true") {
    return;
  }

  const existingTasks = await client.query(`SELECT COUNT(*)::int AS count FROM tasks`);

  if (existingTasks.rows[0].count > 0) {
    return;
  }

  if (process.env.ENABLE_TASK_SEED !== "true") {
    throw new Error("Task seeding is disabled in this environment");
  }

  for (const task of tasks) {
    const status =
      task.status === "not_started"
        ? "assigned"
        : task.status === "completed" && task.verification_status === "pending"
          ? "under_review"
          : task.status === "completed" && task.verification_status === "approved"
            ? "closed"
            : task.verification_status === "rejected"
              ? "rework"
              : task.status;

    await client.query(
      `
        INSERT INTO tasks (
          internal_identifier,
          description,
          assigned_to,
          assigned_by,
          department_id,
          status,
          priority,
          deadline,
          created_at,
          assigned_at,
          verification_status,
          started_at,
          completed_at,
          verified_at,
          proof_url,
          proof_type,
          remarks,
          assignee_ids,
          planned_minutes,
          actual_minutes,
          requires_quality_approval,
          approval_stage,
          closed_at,
          assigned_user_id,
          submitted_at,
          approved_at,
          due_date,
          sla_due_date,
          rejection_count,
          updated_at
        )
        VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $9, $10,
          $11, $12, $13, $14, $15, $16, $17::jsonb, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, NOW()
        )
      `,
      [
        task.title || `TASK-${Date.now()}`,
        task.description,
        task.assigned_to,
        task.assigned_by,
        task.department_id,
        status,
        task.priority,
        task.deadline,
        task.created_at,
        task.verification_status,
        task.started_at,
        task.completed_at,
        task.verified_at,
        Array.isArray(task.proof_url) ? task.proof_url : (task.proof_url ? [task.proof_url] : []),
        task.proof_type,
        task.remarks,
        JSON.stringify([task.assigned_to]),
        60,
        task.completed_at && task.started_at
          ? Math.max(1, Math.round((new Date(task.completed_at).getTime() - new Date(task.started_at).getTime()) / 60000))
          : 0,
        false,
        status === "closed" ? "closed" : status === "under_review" ? "manager" : "execution",
        status === "closed" ? task.verified_at || task.completed_at : null,
        task.assigned_to,
        task.completed_at || null,
        status === "closed" ? task.verified_at || task.completed_at : null,
        task.deadline,
        task.deadline,
        task.verification_status === "rejected" ? 1 : 0,
      ],
    );
  }
}

module.exports = {
  seedTasksIfNeeded,
};
