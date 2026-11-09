"use strict";

const { Hono } = require("hono");
const { getScope, eventBus } = require("../utils");
const { roleStore, roleSchedule } = require("../../index");

const stateRoute = new Hono();

stateRoute.get("/:name/state", async (c) => {
  try {
    const name = decodeURIComponent(c.req.param("name"));
    const scope = getScope(c);
    const roles = await roleStore.getRoles();
    const role = roleStore.findRole(roles, name);
    if (!role) {
      return c.json({ ok: false, error: `角色「${name}」不存在` }, 404);
    }

    const state = await roleSchedule.getState(role.name, { scope });
    const runtimeState = state?.runtimeState || null;
    const affectiveState = state?.affectiveState || null;
    const isSleeping = runtimeState?.phase === "sleeping" || roleSchedule.isSleepEntry(runtimeState);

    return c.json({
      ok: true,
      roleName: role.name,
      isSleeping,
      runtimeState: runtimeState
        ? {
            location: runtimeState.location,
            activity: runtimeState.activity,
            environment: runtimeState.environment,
            outfit: runtimeState.outfit,
            carriedItems: runtimeState.carriedItems,
            mood: runtimeState.mood,
            phase: runtimeState.phase,
            startMinute: runtimeState.entryStartMinute,
            endMinute: runtimeState.entryEndMinute,
            updatedAt: runtimeState.updatedAt,
          }
        : null,
      affectiveState: affectiveState
        ? {
            longTerm: affectiveState.longTerm,
            shortTerm: affectiveState.shortTerm,
            body: affectiveState.body,
            reason: affectiveState.reason,
            updatedAt: affectiveState.updatedAt,
          }
        : null,
    });
  } catch (error) {
    return c.json({ ok: false, error: error.message }, 500);
  }
});

stateRoute.get("/:name/schedule", async (c) => {
  try {
    const name = decodeURIComponent(c.req.param("name"));
    const roles = await roleStore.getRoles();
    const role = roleStore.findRole(roles, name);
    if (!role) {
      return c.json({ ok: false, error: `角色「${name}」不存在` }, 404);
    }

    const schedule = await roleSchedule.getTodaySchedule(role.name);
    if (!schedule) {
      return c.json({ ok: false, error: "尚未生成今日日程" }, 404);
    }

    const formatTime = (min) => {
      if (!Number.isFinite(min)) return "";
      const h = Math.floor(min / 60).toString().padStart(2, "0");
      const m = (min % 60).toString().padStart(2, "0");
      return `${h}:${m}`;
    };

    const formattedEntries = (schedule.entries || []).map((entry) => ({
      ...entry,
      start: formatTime(entry.startMinute),
      end: formatTime(entry.endMinute),
    }));

    return c.json({
      ok: true,
      roleName: role.name,
      dateKey: schedule.dateKey,
      timezone: schedule.timezone,
      source: schedule.source,
      entries: formattedEntries,
      formatted: schedule.formatted,
    });
  } catch (error) {
    return c.json({ ok: false, error: error.message }, 500);
  }
});

stateRoute.get("/:name/plans", async (c) => {
  try {
    const name = decodeURIComponent(c.req.param("name"));
    const horizon = c.req.query("horizon") || "all";
    const roles = await roleStore.getRoles();
    const role = roleStore.findRole(roles, name);
    if (!role) {
      return c.json({ ok: false, error: `角色「${name}」不存在` }, 404);
    }

    const overview = await roleSchedule.getPlanningOverview(role.name);
    if (!overview) {
      return c.json({ ok: false, error: "暂无分层计划" }, 404);
    }

    const formatted = roleSchedule.formatPlanningOverview(overview, horizon);
    return c.json({
      ok: true,
      roleName: role.name,
      horizon,
      overview,
      formatted,
    });
  } catch (error) {
    return c.json({ ok: false, error: error.message }, 500);
  }
});

stateRoute.post("/:name/caffeine", async (c) => {
  try {
    const name = decodeURIComponent(c.req.param("name"));
    const scope = getScope(c);
    const roles = await roleStore.getRoles();
    const role = roleStore.findRole(roles, name);
    if (!role) {
      return c.json({ ok: false, error: `角色「${name}」不存在` }, 404);
    }

    const wakeResult = await roleSchedule.wakeWithCaffeine(role.name, scope);
    eventBus.emit("role.state_updated", { roleName: role.name, scope });

    return c.json({
      ok: true,
      roleName: role.name,
      wakeResult,
      message: wakeResult ? `「${role.name}」已经醒来了并会继续回复。` : `「${role.name}」现在并没有在睡觉。`,
    });
  } catch (error) {
    return c.json({ ok: false, error: error.message }, 500);
  }
});

stateRoute.post("/:name/reset", async (c) => {
  try {
    const name = decodeURIComponent(c.req.param("name"));
    const scope = getScope(c);
    const roles = await roleStore.getRoles();
    const role = roleStore.findRole(roles, name);
    if (!role) {
      return c.json({ ok: false, error: `角色「${name}」不存在` }, 404);
    }

    const resetResult = await roleSchedule.resetRoleStateAndSchedule(role, scope);
    eventBus.emit("role.state_updated", { roleName: role.name, scope });

    return c.json({
      ok: true,
      roleName: role.name,
      resetResult,
      message: `已从零重置「${role.name}」的连续状态并生成全新日程。`,
    });
  } catch (error) {
    return c.json({ ok: false, error: error.message }, 500);
  }
});

module.exports = { stateRoute };
