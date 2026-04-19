const { listEscalationRulesForDepartment } = require("../repositories/referenceRepository");

async function getEscalationSchedule({ departmentId, priority, deadline }) {
  if (!deadline || !priority) {
    return {
      rules: [],
      nextEscalationAt: null,
    };
  }

  const rules = await listEscalationRulesForDepartment(departmentId, priority);
  return {
    rules,
    nextEscalationAt: getNextEscalationAt({ deadline, rules, escalationLevel: 0 }),
  };
}

function getNextEscalationAt({ deadline, rules, escalationLevel }) {
  const rule = Array.isArray(rules) ? rules[escalationLevel] : null;

  if (!deadline || !rule) {
    return null;
  }

  const dueAt = new Date(deadline);
  dueAt.setMinutes(dueAt.getMinutes() + (Number(rule.after_minutes) || 0));
  return dueAt;
}

module.exports = {
  getEscalationSchedule,
  getNextEscalationAt,
};
