"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createApp } = require("../server/app");

test("API: GET /api/health returns ok", async () => {
  const { app } = createApp();
  const res = await app.request("/api/health");
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.ok, true);
  assert.ok(data.timestamp);
});

test("API: GET /api/roles returns enriched roles list", async () => {
  const { app } = createApp();
  const res = await app.request("/api/roles");
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.ok, true);
  assert.ok(Array.isArray(data.roles));
  assert.ok(data.roles.length > 0);
  const role = data.roles.find((r) => r.name === "克里斯蒂安");
  assert.ok(role);
  assert.equal(role.name, "克里斯蒂安");
  assert.ok(role.description);
});

test("API: GET /api/roles/:name returns role details and emotions", async () => {
  const { app } = createApp();
  const res = await app.request(`/api/roles/${encodeURIComponent("克里斯蒂安")}`);
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.ok, true);
  assert.equal(data.role.name, "克里斯蒂安");
  assert.ok(data.role.systemPrompt);
});

test("API: GET /api/roles/:name/state returns runtime & affective states", async () => {
  const { app } = createApp();
  const res = await app.request(`/api/roles/${encodeURIComponent("克里斯蒂安")}/state`);
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.ok, true);
  assert.equal(data.roleName, "克里斯蒂安");
  assert.equal(typeof data.isSleeping, "boolean");
});

test("API: GET /api/roles/:name/schedule returns minute schedule", async () => {
  const { app } = createApp();
  const res = await app.request(`/api/roles/${encodeURIComponent("克里斯蒂安")}/schedule`);
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.ok, true);
  assert.ok(Array.isArray(data.entries));
  assert.ok(data.formatted);
});

test("API: GET /api/roles/:name/plans returns planning overview", async () => {
  const { app } = createApp();
  const res = await app.request(`/api/roles/${encodeURIComponent("克里斯蒂安")}/plans?horizon=all`);
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.ok, true);
  assert.ok(data.overview);
});

test("API: Session switch and message history", async () => {
  const { app } = createApp();
  const switchRes = await app.request("/api/chat/switch", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-chat-id": "888888",
      "x-user-id": "888888",
    },
    body: JSON.stringify({ roleName: "克里斯蒂安" }),
  });
  assert.equal(switchRes.status, 200);
  const switchData = await switchRes.json();
  assert.equal(switchData.ok, true);
  assert.equal(switchData.session.roleName, "克里斯蒂安");

  const msgRes = await app.request("/api/chat/messages", {
    headers: {
      "x-chat-id": "888888",
      "x-user-id": "888888",
    },
  });
  assert.equal(msgRes.status, 200);
  const msgData = await msgRes.json();
  assert.equal(msgData.ok, true);
  assert.ok(Array.isArray(msgData.messages));
});
