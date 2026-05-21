const assert = require("node:assert/strict");
const test = require("node:test");

process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://user:pass@localhost:5432/tasktracker_test";

const {
  buildVisibleUsersCte,
  isProjectAuthorityRoleIdentity,
  isProjectAuthorityRoleLevel,
  normalizeRoleKey,
  visibleProjectPredicate,
} = require("../repositories/projectVisibility");

test("role keys normalize Director/CEO variants for project authority checks", () => {
  assert.equal(normalizeRoleKey("Director/CEO"), "director_ceo");
  assert.equal(normalizeRoleKey(" director ceo "), "director_ceo");
  assert.equal(isProjectAuthorityRoleIdentity("Director/CEO"), true);
  assert.equal(isProjectAuthorityRoleIdentity("director_ceo"), true);
  assert.equal(isProjectAuthorityRoleIdentity("r2"), false);
  assert.equal(isProjectAuthorityRoleIdentity("r3"), false);
});

test("project authority is not granted by numeric hierarchy level", () => {
  assert.equal(isProjectAuthorityRoleLevel(1), false);
  assert.equal(isProjectAuthorityRoleLevel(2), false);
  assert.equal(isProjectAuthorityRoleLevel(3), false);
  assert.equal(isProjectAuthorityRoleLevel(null), false);
});

test("visible users CTE gives project authority roles all active uploaders", () => {
  const sql = buildVisibleUsersCte("$1");
  // CTE builds self + descendant tree only; role hierarchy limits are not expanded here.
  assert.match(sql, /director_ceo/);
  assert.match(sql, /JOIN users child\s+ON COALESCE\(child\.is_active, TRUE\) = TRUE/);
  assert.doesNotMatch(sql, /child_role\.hierarchy_level[\s\S]*>\s*root\.hierarchy_level/);
});

test("visible users CTE gives co-leaders only direct parent Team Leader expansion", () => {
  const sql = buildVisibleUsersCte("$1");

  assert.match(sql, /direct_parent_team_leader/);
  assert.match(sql, /root\.role_key = ANY\(ARRAY\['co_leader', 'team_co_leader'\]::text\[\]\)/);
  assert.match(sql, /role_key = 'team_leader'|team_leader/);
  assert.doesNotMatch(sql, /department_id\s*=/);
  assert.doesNotMatch(sql, /project_leader_id|team_lead_id/);
});

test("project visibility predicate gives project authority roles full project visibility", () => {
  const sql = visibleProjectPredicate("p");

  assert.match(sql, /FROM root_user root/);
  assert.match(sql, /created_by_user_id IN \(SELECT employee_id FROM visible_users\)/);
});
