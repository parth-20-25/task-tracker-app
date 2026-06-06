const assert = require("node:assert/strict");
const test = require("node:test");

const { REDACTED, redactSensitiveData } = require("../lib/redaction");
const { summarizeResultForLog } = require("../lib/observability");

test("redactSensitiveData redacts nested secret-shaped keys", () => {
  const redacted = redactSensitiveData({
    employee_id: "EMP1",
    password: "plain",
    token: "jwt",
    nested: {
      DATABASE_URL: "postgres://secret",
      serviceKey: "service",
      safe: "kept",
    },
  });

  assert.equal(redacted.employee_id, "EMP1");
  assert.equal(redacted.password, REDACTED);
  assert.equal(redacted.token, REDACTED);
  assert.equal(redacted.nested.DATABASE_URL, REDACTED);
  assert.equal(redacted.nested.serviceKey, REDACTED);
  assert.equal(redacted.nested.safe, "kept");
});

test("execution result logging summarizes token-bearing objects", () => {
  const summary = summarizeResultForLog({
    token: "jwt",
    user: { employee_id: "EMP1" },
  });

  assert.deepEqual(summary, {
    type: "Object",
    keys: ["token", "user"],
  });
});
