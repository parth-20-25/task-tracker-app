const assert = require("node:assert/strict");
const test = require("node:test");

process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://user:pass@localhost:5432/tasktracker_test";

const {
  buildVisibleUsersCte,
  isProjectAuthorityRoleIdentity,
  isProjectAuthorityRoleLevel,
  normalizeRoleKey,
} = require("../repositories/projectVisibility");

test("role keys normalize Director/CEO variants for project authority checks", () => {
  assert.equal(normalizeRoleKey("Director/CEO"), "director_ceo");
  assert.equal(normalizeRoleKey(" director ceo "), "director_ceo");
  assert.equal(isProjectAuthorityRoleIdentity("Director/CEO"), true);
  assert.equal(isProjectAuthorityRoleIdentity("director_ceo"), true);
  assert.equal(isProjectAuthorityRoleIdentity("r2"), true);
  assert.equal(isProjectAuthorityRoleIdentity("r3"), false);
});

test("project authority is granted only to top hierarchy levels", () => {
  assert.equal(isProjectAuthorityRoleLevel(1), true);
  assert.equal(isProjectAuthorityRoleLevel(2), true);
  assert.equal(isProjectAuthorityRoleLevel(3), false);
  assert.equal(isProjectAuthorityRoleLevel(null), false);
});

test("visible users CTE gives project authority roles all active uploaders", () => {
  const sql = buildVisibleUsersCte("$1");

  assert.match(sql, /hierarchy_level <= 2/);
  assert.match(sql, /director_ceo/);
  assert.match(sql, /JOIN users child\s+ON COALESCE\(child\.is_active, TRUE\) = TRUE/);
  assert.doesNotMatch(sql, /child_role\.hierarchy_level[\s\S]*>\s*root\.hierarchy_level/);
});
