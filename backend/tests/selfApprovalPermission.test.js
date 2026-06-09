const assert = require("node:assert/strict");
const test = require("node:test");

const {
  PERMISSIONS,
  PERMISSION_DEFINITIONS,
  ROLE_DEFAULT_PERMISSIONS,
} = require("../config/constants");

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
