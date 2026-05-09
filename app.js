require("dotenv").config();
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");
const compression = require("compression");
const auth = require("./src/middleware/auth");
const errorHandler = require("./src/middleware/errorHandler");

const authRoutes = require("./src/modules/auth/routes");
const userRoutes = require("./src/modules/users/routes");
const settingsRoutes = require("./src/modules/settings/routes");
const categoriesRoutes = require("./src/modules/categories/routes");
const suppliersRoutes = require("./src/modules/suppliers/routes");
const productsRoutes = require("./src/modules/products/routes");
const inventoryRoutes = require("./src/modules/inventory/routes");
const salesRoutes = require("./src/modules/sales/routes");
const paymentsRoutes = require("./src/modules/payments/routes");
const reportsRoutes = require("./src/modules/reports/routes");
const auditRoutes = require("./src/modules/audit/routes");
const eodRoutes = require("./src/modules/eod/routes");
const notificationRoutes = require("./src/modules/notifications/routes");
const expensesRoutes = require("./src/modules/expenses/routes");
const paymentNotificationsRoutes = require("./src/modules/payment_notifications/routes");
const chatRoutes = require("./src/modules/chat/routes");

const app = express();
app.use(cors());
app.use(helmet());
app.use(compression());
app.use(morgan("dev"));
app.use(express.json());

app.get("/health", (req, res) => res.json({ success: true, data: { status: "ok" } }));
app.use("/api/auth", authRoutes);
app.use("/api/users", auth, userRoutes);
app.use("/api/settings", auth, settingsRoutes);
app.use("/api/categories", auth, categoriesRoutes);
app.use("/api/suppliers", auth, suppliersRoutes);
app.use("/api/products", auth, productsRoutes);
app.use("/api/inventory", auth, inventoryRoutes);
app.use("/api/sales", auth, salesRoutes);
app.use("/api/payments", auth, paymentsRoutes);
app.use("/api/reports", auth, reportsRoutes);
app.use("/api/audit", auth, auditRoutes);
app.use("/api/eod", auth, eodRoutes);
app.use("/api/notifications", auth, notificationRoutes);
app.use("/api/expenses", auth, expensesRoutes);
app.use("/api/payment-notifications", auth, paymentNotificationsRoutes);
app.use("/api/chat", auth, chatRoutes);

// ─── SSE Fallback Endpoint ────────────────────────────────────────────────────
// Clients that cannot establish a WebSocket connection (corporate proxies/firewalls)
// fall back to this SSE stream. All events from broadcastRealtime() are mirrored here.
app.get("/api/stream", auth, (req, res) => {
  const { addSSEClient, removeSSEClient } = require("./src/realtime");

  res.set({
    "Content-Type":  "text/event-stream",
    "Cache-Control": "no-cache",
    "Connection":    "keep-alive",
    "X-Accel-Buffering": "no", // Disable Nginx buffering
  });
  res.flushHeaders();

  // Send connected confirmation
  res.write(`event: connected\ndata: ${JSON.stringify({ ts: Date.now() })}\n\n`);

  addSSEClient(res);

  // 25-second heartbeat to keep the connection alive through proxies
  const heartbeat = setInterval(() => {
    try { res.write(`:heartbeat\n\n`); } catch (_) {}
  }, 25_000);

  req.on("close", () => {
    clearInterval(heartbeat);
    removeSSEClient(res);
  });
});

app.use((req, res) => res.status(404).json({ success: false, error: "Not found", code: 404 }));
app.use(errorHandler);

module.exports = app;
