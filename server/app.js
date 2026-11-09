"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { Hono } = require("hono");
const { cors } = require("hono/cors");
const { createNodeWebSocket } = require("@hono/node-ws");
const { serveStatic } = require("@hono/node-server/serve-static");

const { rolesRoute } = require("./routes/roles");
const { stateRoute } = require("./routes/state");
const { chatRoute } = require("./routes/chat");
const { assetsRoute } = require("./routes/assets");
const { authRoute } = require("./routes/auth");
const { setupWebSocket } = require("./ws");

function createApp() {
  const app = new Hono();

  // Cross-Origin Resource Sharing
  app.use(
    "*",
    cors({
      origin: "*",
      allowHeaders: ["Content-Type", "Authorization", "x-user-id", "x-chat-id"],
      allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    }),
  );

  // Initialize WebSocket handler for Node
  const { injectWebSocket, upgradeWebSocket } = createNodeWebSocket({ app });

  // Health check
  app.get("/api/health", (c) => {
    return c.json({ ok: true, timestamp: new Date().toISOString() });
  });

  // REST API Routes
  app.route("/api/auth", authRoute);
  app.route("/api/roles", rolesRoute);
  app.route("/api/roles", stateRoute);
  app.route("/api/chat", chatRoute);
  app.route("/api/assets", assetsRoute);

  // WebSocket Route
  app.get("/ws/chat", setupWebSocket(upgradeWebSocket));

  // Serve static Web build if available
  const clientDist = path.join(__dirname, "../client/dist");
  if (fs.existsSync(clientDist)) {
    app.use("/*", serveStatic({ root: "./client/dist" }));
  }

  // Global Error Handler
  app.onError((err, c) => {
    console.error("API Server Error:", err);
    return c.json({ ok: false, error: err.message || "Internal Server Error" }, 500);
  });

  return { app, injectWebSocket };
}

module.exports = { createApp };
