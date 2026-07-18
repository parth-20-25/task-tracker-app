const { WebSocketServer } = require("ws");
const { pool } = require("../db");
const { logger } = require("../lib/logger");
const {
  authenticateDesktopDevice,
  listPendingForDevice,
  markSentToDevice,
  recordClicked,
  recordDisplayed,
} = require("../services/desktopNotificationService");
const { getNotificationById } = require("../repositories/desktopNotificationRepository");

const WS_PATH = "/ws/desktop-notifications";
const MAX_PAYLOAD_BYTES = 16 * 1024;
const HEARTBEAT_MS = 30 * 1000;

const connectionsByUser = new Map();
const connectionsByDevice = new Map();

function getHeader(req, name) {
  return req.headers[String(name).toLowerCase()] || "";
}

function getBearerToken(req) {
  const [scheme, token] = String(getHeader(req, "authorization")).split(" ");
  return scheme === "Bearer" ? token : "";
}

function addConnection(device, ws) {
  const existing = connectionsByDevice.get(device.device_id);
  if (existing && existing.readyState === 1) {
    existing.close(4000, "Superseded by a new connection");
  }

  connectionsByDevice.set(device.device_id, ws);
  if (!connectionsByUser.has(device.user_id)) {
    connectionsByUser.set(device.user_id, new Map());
  }
  connectionsByUser.get(device.user_id).set(device.device_id, ws);
}

function removeConnection(device, ws) {
  if (connectionsByDevice.get(device.device_id) === ws) {
    connectionsByDevice.delete(device.device_id);
  }
  const userConnections = connectionsByUser.get(device.user_id);
  if (userConnections?.get(device.device_id) === ws) {
    userConnections.delete(device.device_id);
  }
  if (userConnections?.size === 0) {
    connectionsByUser.delete(device.user_id);
  }
}

function notificationEnvelope(notification) {
  return JSON.stringify({ type: "desktop_notification", notification });
}

async function sendNotificationToSocket(ws, device, notification) {
  if (ws.readyState !== 1) return false;
  ws.send(notificationEnvelope(notification));
  await markSentToDevice(device, notification.id);
  return true;
}

async function sendToUser(userId, notification) {
  const userConnections = connectionsByUser.get(String(userId));
  if (!userConnections) return 0;

  let sent = 0;
  for (const [deviceId, ws] of userConnections.entries()) {
    const device = ws.parcDevice;
    if (!device || device.device_id !== deviceId) continue;
    try {
      if (await sendNotificationToSocket(ws, device, notification)) sent += 1;
    } catch (error) {
      logger.warn("Desktop notification socket send failed", {
        user_id: userId,
        device_id: deviceId,
        error: error?.message || "Unknown send error",
      });
    }
  }
  return sent;
}

async function sendPending(ws, device) {
  const pending = await listPendingForDevice(device, 100);
  ws.send(JSON.stringify({ type: "pending_notifications", notifications: pending }));
  return pending.length;
}

async function handleClientMessage(ws, raw) {
  let message;
  try {
    message = JSON.parse(String(raw));
  } catch (_error) {
    ws.close(1003, "Invalid JSON");
    return;
  }

  const device = ws.parcDevice;
  if (!device || !message || typeof message !== "object") {
    ws.close(1008, "Unauthenticated");
    return;
  }

  if (message.type === "sync_pending_notifications") {
    await sendPending(ws, device);
    return;
  }

  if (message.type === "notification_displayed") {
    const notificationId = Number(message.notificationId);
    if (!Number.isInteger(notificationId)) throw new Error("Invalid notificationId");
    await recordDisplayed(device, notificationId, message.displayedAt ? new Date(message.displayedAt) : new Date());
    return;
  }

  if (message.type === "notification_clicked") {
    const notificationId = Number(message.notificationId);
    if (!Number.isInteger(notificationId)) throw new Error("Invalid notificationId");
    await recordClicked(device, notificationId, message.clickedAt ? new Date(message.clickedAt) : new Date());
    return;
  }

  ws.close(1003, "Unsupported message type");
}

async function startPostgresNotificationListener() {
  const listener = await pool.connect();
  await listener.query("LISTEN desktop_notifications");
  listener.on("notification", async (message) => {
    try {
      const payload = JSON.parse(message.payload || "{}");
      const notification = await getNotificationById(Number(payload.notificationId));
      if (!notification) return;
      await sendToUser(payload.userId, notification);
    } catch (error) {
      logger.warn("Desktop notification LISTEN handler failed", { error: error?.message || "Unknown listener error" });
    }
  });
  listener.on("error", (error) => {
    logger.error("Desktop notification LISTEN connection failed", { error: error?.message || "Unknown listener error" });
  });
  return listener;
}

function rejectUpgrade(socket, statusCode = 401, message = "Unauthorized") {
  socket.write(`HTTP/1.1 ${statusCode} ${message}\r\nConnection: close\r\n\r\n`);
  socket.destroy();
}

function initializeDesktopNotificationGateway(server) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_PAYLOAD_BYTES });

  server.on("upgrade", async (req, socket, head) => {
    let pathname = "";
    try {
      pathname = new URL(req.url, "http://localhost").pathname;
    } catch (_error) {
      return rejectUpgrade(socket, 400, "Bad Request");
    }

    if (pathname !== WS_PATH) return;

    let device;
    try {
      device = await authenticateDesktopDevice({
        deviceId: getHeader(req, "x-parc-device-id"),
        token: getBearerToken(req),
        agentVersion: getHeader(req, "x-parc-agent-version"),
      });
    } catch (_error) {
      return rejectUpgrade(socket, 401, "Unauthorized");
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      ws.parcDevice = device;
      wss.emit("connection", ws, req, device);
    });
  });

  wss.on("connection", async (ws, _req, device) => {
    ws.isAlive = true;
    ws.on("pong", () => { ws.isAlive = true; });
    ws.on("message", (raw) => {
      handleClientMessage(ws, raw).catch((error) => {
        logger.warn("Desktop notification client message rejected", {
          device_id: device.device_id,
          error: error?.message || "Unknown message error",
        });
        ws.close(1008, "Invalid message");
      });
    });
    ws.on("close", () => removeConnection(device, ws));
    ws.on("error", () => removeConnection(device, ws));

    addConnection(device, ws);
    try {
      await sendPending(ws, device);
    } catch (error) {
      logger.warn("Desktop notification initial sync failed", {
        device_id: device.device_id,
        error: error?.message || "Unknown sync error",
      });
    }
  });

  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (ws.isAlive === false) {
        ws.terminate();
        continue;
      }
      ws.isAlive = false;
      ws.ping();
    }
  }, HEARTBEAT_MS);
  wss.on("close", () => clearInterval(heartbeat));

  startPostgresNotificationListener().catch((error) => {
    logger.error("Desktop notification listener startup failed", { error: error?.message || "Unknown listener startup error" });
  });

  return wss;
}

module.exports = {
  WS_PATH,
  initializeDesktopNotificationGateway,
  sendToUser,
};
