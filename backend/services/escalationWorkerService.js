const { pool } = require("../db");
const { createAuditLog } = require("../repositories/auditRepository");
const { createNotification } = require("../repositories/notificationsRepository");
const { advanceTaskEscalation, listTasksDueForEscalation } = require("../repositories/tasksRepository");
const { listUsersByRoleAndDepartment } = require("../repositories/usersRepository");
const { getNextEscalationAt } = require("./escalationService");
const { listEscalationRulesForDepartment } = require("../repositories/referenceRepository");

const ESCALATION_POLL_INTERVAL_MS = 60 * 1000;
const ESCALATION_BATCH_SIZE = 100;

async function runEscalationCycle() {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    const tasks = await listTasksDueForEscalation(ESCALATION_BATCH_SIZE, client);

    for (const task of tasks) {
      const rules = await listEscalationRulesForDepartment(task.department_id, task.priority, client);
      const currentRule = rules[task.escalation_level] || null;
      const targetDepartmentId = currentRule?.department_id || task.department_id || null;
      const nextEscalationAt = getNextEscalationAt({
        deadline: task.deadline,
        rules,
        escalationLevel: task.escalation_level + 1,
      });

      if (!currentRule) {
        await advanceTaskEscalation(task.id, {
          escalation_level: task.escalation_level,
          last_escalated_at: task.last_escalated_at || null,
          next_escalation_at: null,
        }, client);
        continue;
      }

      const recipients = currentRule.notify_role
        ? await listUsersByRoleAndDepartment(currentRule.notify_role, targetDepartmentId, client)
        : [];

      if (recipients.length > 0) {
        for (const recipient of recipients) {
          await createNotification({
            userEmployeeId: recipient.employee_id,
            title: `Escalated task: ${task.title}`,
            body: `Task #${task.id} is overdue and matched escalation rule ${currentRule.name}.`,
            type: "warning",
            targetType: "task",
            targetId: task.id,
          }, client);
        }
      } else {
        await createNotification({
          departmentId: targetDepartmentId,
          title: `Escalated task: ${task.title}`,
          body: `Task #${task.id} is overdue and matched escalation rule ${currentRule.name}.`,
          type: "warning",
          targetType: "task",
          targetId: task.id,
        }, client);
      }

      await createAuditLog({
        userEmployeeId: null,
        actionType: "task_escalated",
        targetType: "task",
        targetId: task.id,
        metadata: {
          escalation_rule_id: currentRule.id,
          escalation_rule_name: currentRule.name,
          escalation_level: task.escalation_level + 1,
          notified_role: currentRule.notify_role,
          notified_department_id: targetDepartmentId,
          notified_user_ids: recipients.map((recipient) => recipient.employee_id),
          priority: task.priority,
        },
      }, client);

      await advanceTaskEscalation(task.id, {
        escalation_level: task.escalation_level + 1,
        last_escalated_at: new Date(),
        next_escalation_at: nextEscalationAt,
      }, client);
    }

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

function startEscalationWorker() {
  runEscalationCycle().catch((error) => {
    console.error("ESCALATION WORKER ERROR:", error);
  });

  const timer = setInterval(() => {
    runEscalationCycle().catch((error) => {
      console.error("ESCALATION WORKER ERROR:", error);
    });
  }, ESCALATION_POLL_INTERVAL_MS);

  timer.unref?.();
  return timer;
}

module.exports = {
  runEscalationCycle,
  startEscalationWorker,
};
