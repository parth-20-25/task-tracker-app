const assert = require("node:assert/strict");
const test = require("node:test");

process.env.DATABASE_URL ||= "postgresql://tasktracker_test:tasktracker_test@localhost:5432/tasktracker_test";

const {
  PERMISSIONS,
  PERMISSION_DEFINITIONS,
  ROLE_DEFAULT_PERMISSIONS,
} = require("../config/constants");
const { hasPermission } = require("../services/accessControlService");

test("self_approve is a catalog permission but not a default role grant", () => {
  const permissionIds = PERMISSION_DEFINITIONS.map(([permissionId]) => permissionId);

  assert.equal(permissionIds.includes(PERMISSIONS.SELF_APPROVE), true);

  for (const [roleId, permissionIdsForRole] of Object.entries(ROLE_DEFAULT_PERMISSIONS)) {
    assert.equal(
      permissionIdsForRole.includes(PERMISSIONS.SELF_APPROVE),
      false,
      `${roleId} should not receive self_approve automatically`,
    );
  }
});

test("self_approve is honored only when explicitly granted", () => {
  assert.equal(
    hasPermission({
      employee_id: "159",
      role: {
        id: "r1",
        permissions: { all: true },
      },
      permissions: [],
    }, PERMISSIONS.SELF_APPROVE),
    false,
  );

  assert.equal(
    hasPermission({
      employee_id: "159",
      role: {
        id: "r5",
        permissions: {},
      },
      permissions: [PERMISSIONS.SELF_APPROVE],
    }, PERMISSIONS.SELF_APPROVE),
    true,
  );

  assert.equal(
    hasPermission({
      employee_id: "159",
      role: {
        id: "r5",
        permissions: { [PERMISSIONS.SELF_APPROVE]: true },
      },
      permissions: [],
    }, PERMISSIONS.SELF_APPROVE),
    true,
  );
});
