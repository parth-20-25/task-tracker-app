const { canonicalFixtureNo } = require("../designIngestion/normalize");

/**
 * Deterministic identity key for maps: canonical fixture number only (DB enforces uniqueness per project_id).
 */
function fixtureCanonicalKey(fixtureNo) {
  return canonicalFixtureNo(fixtureNo).toLowerCase();
}

/**
 * Full logical identity tuple (project_id + normalized fixture number).
 */
function fixtureOperationalIdentity(projectId, fixtureNo) {
  return `${projectId}::${fixtureCanonicalKey(fixtureNo)}`;
}

module.exports = {
  canonicalFixtureNo,
  fixtureCanonicalKey,
  fixtureOperationalIdentity,
};
