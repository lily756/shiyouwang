"use strict";

const { Hono } = require("hono");
const { getScope } = require("../utils");
const { roleStore, roleSchedule, db } = require("../../index");

const rolesRoute = new Hono();

rolesRoute.get("/", async (c) => {
  try {
    const scope = getScope(c);
    const roles = await roleStore.getRoles();

    // Attach current activity and avatar info for each role
    const enrichedRoles = await Promise.all(
      roles.map(async (role) => {
        let currentActivity = "";
        let location = "";
        let isSleeping = false;
        try {
          const state = await roleSchedule.getState(role.name, { scope });
          currentActivity = state?.runtimeState?.activity || "";
          location = state?.runtimeState?.location || "";
          isSleeping = state?.runtimeState?.phase === "sleeping" || roleSchedule.isSleepEntry(state?.runtimeState);
        } catch {
          // ignore transient state read error
        }

        // Check if there is an avatar reference in DB
        const refImage = await db.findOneAsync({
          type: "role-reference-image",
          roleName: role.name,
        });

        return {
          id: role._id,
          name: role.name,
          description: role.description,
          avatarUrl: refImage ? `/api/assets/roles/${encodeURIComponent(role.name)}` : null,
          currentActivity,
          location,
          isSleeping,
        };
      }),
    );

    return c.json({ ok: true, roles: enrichedRoles });
  } catch (error) {
    return c.json({ ok: false, error: error.message }, 500);
  }
});

rolesRoute.get("/:name", async (c) => {
  try {
    const name = decodeURIComponent(c.req.param("name"));
    const scope = getScope(c);
    const roles = await roleStore.getRoles();
    const role = roleStore.findRole(roles, name);
    if (!role) {
      return c.json({ ok: false, error: `角色「${name}」不存在` }, 404);
    }

    const state = await roleSchedule.getState(role.name, { scope });
    const refImage = await db.findOneAsync({
      type: "role-reference-image",
      roleName: role.name,
    });

    return c.json({
      ok: true,
      role: {
        id: role._id,
        name: role.name,
        description: role.description,
        systemPrompt: role.systemPrompt,
        avatarUrl: refImage ? `/api/assets/roles/${encodeURIComponent(role.name)}` : null,
        currentState: state?.runtimeState || null,
        emotions: state?.affectiveState || null,
      },
    });
  } catch (error) {
    return c.json({ ok: false, error: error.message }, 500);
  }
});

rolesRoute.post("/:name/refresh-prompt", async (c) => {
  try {
    const name = decodeURIComponent(c.req.param("name"));
    const scope = getScope(c);
    const roles = await roleStore.getRoles();
    const role = roleStore.findRole(roles, name);
    if (!role) {
      return c.json({ ok: false, error: `角色「${name}」不存在` }, 404);
    }

    const session = await roleStore.findActiveSession(scope);
    if (!session || session.roleName !== role.name) {
      return c.json({ ok: false, error: "当前会话角色与指定角色不一致" }, 400);
    }

    await roleStore.refreshActiveSessionSystemPrompt(scope, role);
    return c.json({ ok: true, message: `已成功刷新角色「${role.name}」的提示词，历史对话已保留。` });
  } catch (error) {
    return c.json({ ok: false, error: error.message }, 500);
  }
});

module.exports = { rolesRoute };
