const assert = require("node:assert/strict");
const test = require("node:test");

process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://user:pass@localhost:5432/tasktracker_test";

const {
  buildVisibleUsersCte,
  identifierInVisibleUsersSql,
  isProjectAuthorityRoleIdentity,
  isProjectAuthorityRoleLevel,
  normalizeRoleKey,
  visibleProjectPredicate,
} = require("../repositories/projectVisibility");
const {
  userIdentifierMatchSql,
  userResolutionLateralSql,
} = require("../repositories/sqlFragments");

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

test("visible users CTE gives co-leaders parent Team Leader team expansion", () => {
  const sql = buildVisibleUsersCte("$1");

  assert.match(sql, /direct_parent_team_leader/);
  assert.match(sql, /co_leader_team_tree/);
  assert.match(sql, /root\.role_key = ANY\(ARRAY\['co_leader', 'team_co_leader', 'shift_incharge'\]::text\[\]\)/);
  assert.match(sql, /role_key = 'team_leader'|team_leader/);
  assert.match(sql, /JOIN co_leader_team_tree/);
  assert.doesNotMatch(sql, /department_id\s*=/);
  assert.doesNotMatch(sql, /project_leader_id|team_lead_id/);
});

test("project visibility predicate gives project authority roles full project visibility", () => {
  const sql = visibleProjectPredicate("p");

  assert.match(sql, /FROM root_user root/);
  assert.match(sql, /p\.created_by_user_id/);
  assert.match(sql, /visible_identifier_user\.employee_id/);
  assert.match(sql, /visible_identifier_user\.user_uuid/);
});

test("identifier visibility helper matches employee ids, user UUIDs, and numeric text variants", () => {
  const sql = identifierInVisibleUsersSql("p.created_by_user_id");

  assert.match(sql, /visible_identifier_user\.employee_id = NULLIF/);
  assert.match(sql, /visible_identifier_user\.user_uuid = NULLIF/);
  assert.match(sql, /REGEXP_REPLACE/);
});

test("user identifier join helper attempts non-employee-id keys before falling back to Unknown User", () => {
  const sql = userIdentifierMatchSql("u", "candidate.identifier");

  assert.match(sql, /u\.employee_id = NULLIF/);
  assert.match(sql, /u\.id::text = NULLIF/);
  assert.match(sql, /LOWER\(u\.email\) = LOWER/);
  assert.match(sql, /REGEXP_REPLACE/);
});

test("user resolution lateral tries later candidates when a legacy uploader key is stale", () => {
  const sql = userResolutionLateralSql("uploader", [
    { expression: "ub.uploaded_by_user_id", source: "upload_batch_uploaded_by_user_id" },
    { expression: "ub.uploaded_by", source: "upload_batch_uploaded_by" },
    { expression: "dp.created_by_user_id", source: "project_created_by_user_id" },
  ]);

  assert.match(sql, /VALUES/);
  assert.match(sql, /upload_batch_uploaded_by_user_id/);
  assert.match(sql, /upload_batch_uploaded_by/);
  assert.match(sql, /project_created_by_user_id/);
  assert.match(sql, /ORDER BY candidate\.priority ASC/);
  assert.doesNotMatch(sql, /COALESCE\(ub\.uploaded_by_user_id/);
});
