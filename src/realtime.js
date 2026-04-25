const WebSocket = require("ws");
const { WebSocketServer } = WebSocket;

let wssInstance = null;
const HEARTBEAT_MS = 25000;

const initRealtime = (server) => {
  wssInstance = new WebSocketServer({ noServer: true });
  server.on("upgrade", (request, socket, head) => {
    const rawUrl = String(request.url || "");
    const pathname = rawUrl.split("?")[0];
    const isWsPath = /^\/(?:api\/)?ws\/?$/.test(pathname);
    if (!isWsPath) {
      socket.destroy();
      return;
    }
    wssInstance.handleUpgrade(request, socket, head, (client) => {
      wssInstance.emit("connection", client, request);
    });
  });
  wssInstance.on("connection", (socket) => {
    socket.isAlive = true;
    socket.on("pong", () => {
      socket.isAlive = true;
    });
    socket.send(JSON.stringify({ type: "connected", ts: Date.now() }));
  });
  if (wssInstance.__heartbeatTimer) clearInterval(wssInstance.__heartbeatTimer);
  wssInstance.__heartbeatTimer = setInterval(() => {
    if (!wssInstance) return;
    wssInstance.clients.forEach((client) => {
      if (client.readyState !== WebSocket.OPEN) return;
      if (client.isAlive === false) {
        try {
          client.terminate();
        } catch {
          // noop
        }
        return;
      }
      client.isAlive = false;
      try {
        client.ping();
        client.send(JSON.stringify({ type: "heartbeat", ts: Date.now() }));
      } catch {
        // noop
      }
    });
  }, HEARTBEAT_MS);
  return wssInstance;
};

const broadcastRealtime = (payload) => {
  if (!wssInstance) return;
  const msg = JSON.stringify({ ...payload, ts: Date.now() });
  wssInstance.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) client.send(msg);
  });
};

module.exports = { initRealtime, broadcastRealtime };
