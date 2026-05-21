const assert = require("node:assert/strict");
const test = require("node:test");

process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://user:pass@localhost:5432/tasktracker_test";

const { PERMISSIONS } = require("../config/constants");
const { hasOrgWideVisibility, groupProjectsByTeamLeader } = require("../services/visibilityResolutionService");
const { visibleProjectPredicate } = require("../repositories/projectVisibility");

function makeUser(overrides = {}) {
  return {
    employee_id: "EMP100",
    department_id: "design",
    permissions: [],
    role: {
      id: "r-worker",
      name: "Designer",
      hierarchy_level: 6,
      permissions: {},
    },
    visible_user_ids: ["EMP100"],
    ...overrides,
  };
}

test("hasOrgWideVisibility treats CEO/Director and Admin as org-wide authorities", () => {
  const admin = makeUser({
    role: { id: "r1", name: "Admin", hierarchy_level: 1, permissions: {} },
  });
  const directorCeo = makeUser({
    role: { id: "director_ceo", name: "Director/CEO", hierarchy_level: 2, permissions: {} },
  });
  const manager = makeUser({
    permissions: [PERMISSIONS.VIEW_ALL_TASKS],
    role: { id: "r3", name: "Manager", hierarchy_level: 3, permissions: {} },
  });

  assert.equal(hasOrgWideVisibility(admin), true);
  assert.equal(hasOrgWideVisibility(directorCeo), true);
  assert.equal(hasOrgWideVisibility(manager), false);
});

test("project visibility predicate includes team lead and project leader ownership", () => {
  const sql = visibleProjectPredicate("p");

  assert.match(sql, /created_by_user_id IN \(SELECT employee_id FROM visible_users\)/);
});

test("groupProjectsByTeamLeader clusters projects under operational owner", () => {
  const groups = groupProjectsByTeamLeader([
    { project_id: "1", project_no: "A", team_lead_id: "TL1", team_lead_name: "Michael Smith" },
    { project_id: "2", project_no: "B", team_lead_id: "TL1", team_lead_name: "Michael Smith" },
    { project_id: "3", project_no: "C", team_lead_id: "TL2", team_lead_name: "Anita K." },
  ]);

  assert.equal(groups.length, 2);
  assert.equal(groups.find((group) => group.team_leader_name === "Michael Smith")?.projects.length, 2);
  assert.equal(groups.find((group) => group.team_leader_name === "Anita K.")?.projects.length, 1);
});
