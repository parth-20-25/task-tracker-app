const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const test = require("node:test");

process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://user:pass@localhost:5432/tasktracker_test";
process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret";
process.env.CORS_ORIGIN = process.env.CORS_ORIGIN || "http://localhost:5173";

const deviceId = "11111111-1111-4111-8111-111111111111";

function hashToken(token) {
  return crypto.createHash("sha256").update(token, "utf8").digest("hex");
}

function loadServiceWithDevice(device) {
  const repository = require("../repositories/desktopNotificationRepository");
  const originals = {
    findDeviceByDeviceId: repository.findDeviceByDeviceId,
    touchDeviceConnected: repository.touchDeviceConnected,
  };
  const calls = { touched: [] };

  repository.findDeviceByDeviceId = async () => device;
  repository.touchDeviceConnected = async (id, agentVersion) => {
    calls.touched.push({ id, agentVersion });
    return { ...device, last_connected_at: new Date().toISOString(), agent_version: agentVersion };
  };

  delete require.cache[require.resolve("../services/desktopNotificationService")];
  const service = require("../services/desktopNotificationService");

  return {
    calls,
    service,
    restore() {
      repository.findDeviceByDeviceId = originals.findDeviceByDeviceId;
      repository.touchDeviceConnected = originals.touchDeviceConnected;
      delete require.cache[require.resolve("../services/desktopNotificationService")];
    },
  };
}

test("invalid desktop device token is rejected", async () => {
  const mocks = loadServiceWithDevice({
    device_id: deviceId,
    user_id: "940",
    token_hash: hashToken("valid-token"),
    enabled: true,
    revoked_at: null,
  });
  try {
    await assert.rejects(
      () => mocks.service.authenticateDesktopDevice({ deviceId, token: "wrong-token", agentVersion: "test" }),
      /Invalid device token/,
    );
    assert.equal(mocks.calls.touched.length, 0);
  } finally {
    mocks.restore();
  }
});

test("revoked or disabled desktop device is rejected", async () => {
  for (const row of [
    { enabled: true, revoked_at: new Date().toISOString() },
    { enabled: false, revoked_at: null },
  ]) {
    const mocks = loadServiceWithDevice({
      device_id: deviceId,
      user_id: "940",
      token_hash: hashToken("valid-token"),
      ...row,
    });
    try {
      await assert.rejects(
        () => mocks.service.authenticateDesktopDevice({ deviceId, token: "valid-token", agentVersion: "test" }),
        /Device is not registered/,
      );
      assert.equal(mocks.calls.touched.length, 0);
    } finally {
      mocks.restore();
    }
  }
});