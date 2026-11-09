"use strict";

const path = require("node:path");
require("dotenv").config({ path: path.join(__dirname, "../.env") });

const { serve } = require("@hono/node-server");
const { createApp } = require("./app");

const PORT = Number(process.env.API_PORT) || 3000;
const HOST = process.env.API_HOST || "0.0.0.0";

const { app, injectWebSocket } = createApp();

const server = serve(
  {
    fetch: app.fetch,
    port: PORT,
    hostname: HOST,
  },
  (info) => {
    console.log(`🚀 Hono API & WebSocket 服务已启动: http://${info.address}:${info.port}`);
    console.log(`📡 WebSocket 对话地址: ws://${info.address}:${info.port}/ws/chat`);
  },
);

injectWebSocket(server);

if (process.env.START_BOT === "true" || process.env.npm_lifecycle_event === "all") {
  const { launchBot } = require("../index");
  launchBot().catch((err) => {
    console.error("启动 Telegram Bot 异常:", err.message);
  });
}

module.exports = { app, server };
