function createAdminFlow({
  db,
  findRole,
  formatAdminRoleList,
  formatRoleList,
  formatToolStatus,
  getRoles,
  getToolSettings,
  isImageEditConfigured,
  isImageGenerationConfigured,
  isVideoGenerationConfigured,
  normalizeRole,
  replyWithText,
  setToolEnabled,
}) {
  async function find(scope) {
    return db.findOneAsync({ type: "admin-role-flow", ...scope });
  }

  async function set(scope, step, draft = {}) {
    const existing = await find(scope);
    const updatedAt = new Date().toISOString();
    if (existing) {
      await db.updateAsync({ _id: existing._id }, { $set: { step, draft, updatedAt } });
      return;
    }
    await db.insertAsync({
      type: "admin-role-flow",
      ...scope,
      step,
      draft,
      createdAt: updatedAt,
      updatedAt,
    });
  }

  function clear(scope) {
    return db.removeAsync({ type: "admin-role-flow", ...scope }, { multi: true });
  }

  function menu() {
    return "角色管理模式已开启。\n\n请输入：新增、编辑、删除、查看、功能，或 取消。\n管理模式下的文字不会发送给角色。";
  }

  function normalizeAction(text) {
    const value = text.trim().toLocaleLowerCase();
    if (["新增", "添加", "创建", "new", "create"].includes(value)) return "create";
    if (["编辑", "修改", "edit", "update"].includes(value)) return "edit";
    if (["删除", "移除", "delete", "remove"].includes(value)) return "delete";
    if (["查看", "列表", "list", "read"].includes(value)) return "read";
    if (["功能", "工具", "设置", "tools", "settings"].includes(value)) return "tools";
    return null;
  }

  function toolMenu(settings) {
    return `${formatToolStatus(settings)}\n\n请输入：时间、图片、图片编辑、视频、看图、搜索、生活、状态 或 返回。`;
  }

  function normalizeTool(text) {
    const value = text.trim().toLocaleLowerCase();
    if (["时间", "time"].includes(value)) return { settingName: "timeEnabled", label: "当前时间" };
    if (["图片", "图像", "生成图片", "image"].includes(value)) return { settingName: "imageEnabled", label: "角色图片" };
    if (["换装", "图片换装", "图片编辑", "i2i", "image edit"].includes(value)) return { settingName: "imageEditEnabled", label: "图片编辑（I2I）" };
    if (["视频", "生成视频", "角色视频", "video"].includes(value)) return { settingName: "videoEnabled", label: "角色视频" };
    if (["看图", "读图", "图片理解", "视觉", "vision"].includes(value)) return { settingName: "visionEnabled", label: "图片理解" };
    if (["搜索", "联网搜索", "web", "search"].includes(value)) return { settingName: "webSearchEnabled", label: "联网搜索" };
    if (["生活", "生活助手", "life", "assistant"].includes(value)) return { settingName: "lifeAssistantEnabled", label: "生活助手" };
    return null;
  }

  function normalizeToggle(text) {
    const value = text.trim().toLocaleLowerCase();
    if (["开启", "开", "启用", "on", "enable"].includes(value)) return true;
    if (["关闭", "关", "停用", "off", "disable"].includes(value)) return false;
    return null;
  }

  function normalizeField(text) {
    const value = text.trim().toLocaleLowerCase();
    if (["名称", "名字", "name"].includes(value)) return "name";
    if (["简介", "描述", "description"].includes(value)) return "description";
    if (["提示词", "system prompt", "systemprompt", "prompt"].includes(value)) return "systemPrompt";
    return null;
  }

  function isCancel(text) {
    return ["取消", "退出", "cancel", "exit"].includes(text.trim().toLocaleLowerCase());
  }

  function isValidRoleName(name) {
    return name.length > 0 && name.length <= 64;
  }

  async function handle(ctx, scope, flow, text) {
    const value = text.trim();
    if (isCancel(value)) {
      await clear(scope);
      await ctx.reply("已退出角色管理模式。你现在可以继续角色对话。");
      return;
    }

    if (flow.step === "choose-action") {
      const action = normalizeAction(value);
      if (action === "read") {
        await replyWithText(ctx, `${formatAdminRoleList(await getRoles())}\n\n${menu()}`);
        return;
      }
      if (action === "create") {
        await set(scope, "create-name");
        await ctx.reply("请输入新角色名称（64 个字符以内）。发送 取消 可退出管理模式。");
        return;
      }
      if (action === "tools") {
        await set(scope, "tool-menu");
        await ctx.reply(toolMenu(await getToolSettings()));
        return;
      }
      if (action === "edit" || action === "delete") {
        const roles = await getRoles();
        if (roles.length === 0) {
          await ctx.reply(`当前没有可${action === "edit" ? "编辑" : "删除"}角色。\n\n${menu()}`);
          return;
        }
        await set(scope, action === "edit" ? "edit-select" : "delete-select");
        await replyWithText(ctx, `请输入要${action === "edit" ? "编辑" : "删除"}的角色名称：\n\n${formatRoleList(roles)}`);
        return;
      }
      await ctx.reply(`未识别该操作。\n\n${menu()}`);
      return;
    }

    if (flow.step === "tool-menu") {
      const normalizedValue = value.toLocaleLowerCase();
      if (["状态", "status"].includes(normalizedValue)) {
        await ctx.reply(toolMenu(await getToolSettings()));
        return;
      }
      if (["返回", "back"].includes(normalizedValue)) {
        await set(scope, "choose-action");
        await ctx.reply(menu());
        return;
      }
      const tool = normalizeTool(value);
      if (!tool) {
        await ctx.reply("未识别该工具。请输入：时间、图片、图片编辑、视频、看图、搜索、生活、状态 或 返回。");
        return;
      }
      await set(scope, "tool-toggle", tool);
      await ctx.reply(`请输入“开启”或“关闭”${tool.label}功能。`);
      return;
    }

    if (flow.step === "tool-toggle") {
      const enabled = normalizeToggle(value);
      if (enabled === null) {
        await ctx.reply("请输入“开启”或“关闭”。");
        return;
      }
      const tool = flow.draft;
      if (tool?.settingName === "imageEnabled" && enabled && !isImageGenerationConfigured()) {
        await ctx.reply("无法开启角色图片功能：请先配置当前图片服务所需的 API 地址和 API Key，然后重启机器人。");
        return;
      }
      if (tool?.settingName === "imageEditEnabled" && enabled && !isImageEditConfigured()) {
        await ctx.reply("无法开启图片编辑（I2I）：请先配置当前图片服务所需的 API 地址和 API Key，然后重启机器人。");
        return;
      }
      if (tool?.settingName === "videoEnabled" && enabled && !isVideoGenerationConfigured()) {
        await ctx.reply("无法开启角色视频功能：请先配置 SEEDANCE_API_TOKEN 并重启机器人。");
        return;
      }
      if (!tool?.settingName || !tool?.label) {
        await clear(scope);
        await ctx.reply("工具管理状态无效，已退出。请重新发送 /admin。");
        return;
      }
      await set(scope, "tool-menu");
      const settings = await setToolEnabled(tool.settingName, enabled, scope.userId);
      await ctx.reply(`已${enabled ? "开启" : "关闭"}${tool.label}功能。\n\n${toolMenu(settings)}`);
      return;
    }

    if (flow.step === "create-name") {
      if (!isValidRoleName(value)) {
        await ctx.reply("角色名称不能为空且不能超过 64 个字符，请重新输入。");
        return;
      }
      if (findRole(await getRoles(), value)) {
        await ctx.reply("已存在同名角色，请换一个名称。");
        return;
      }
      await set(scope, "create-description", { name: value });
      await ctx.reply("请输入角色简介；发送 - 可跳过简介。");
      return;
    }

    if (flow.step === "create-description") {
      await set(scope, "create-system-prompt", { ...flow.draft, description: value === "-" ? "" : value });
      await ctx.reply("请输入该角色的 system prompt。可以直接发送多行文本。");
      return;
    }

    if (flow.step === "create-system-prompt") {
      const role = normalizeRole({ name: flow.draft?.name, description: flow.draft?.description, systemPrompt: value });
      if (!role) {
        await ctx.reply("System prompt 不能为空，请重新输入。");
        return;
      }
      if (findRole(await getRoles(), role.name)) {
        await clear(scope);
        await ctx.reply("保存时发现同名角色，已取消新增。请重新发送 /admin 操作。");
        return;
      }
      const now = new Date().toISOString();
      await db.insertAsync({
        type: "role", name: role.name, nameKey: role.nameKey, description: role.description,
        systemPrompt: role.systemPrompt, createdAt: now, updatedAt: now,
        createdBy: scope.userId, updatedBy: scope.userId,
      });
      await clear(scope);
      await ctx.reply(`已新增角色「${role.name}」。发送 /admin 可继续管理。`);
      return;
    }

    if (flow.step === "edit-select") {
      const role = findRole(await getRoles(), value);
      if (!role?.id) {
        await ctx.reply("没有找到该角色，请重新输入角色名称。");
        return;
      }
      await set(scope, "edit-field", { roleId: role.id, roleName: role.name });
      await ctx.reply(`正在编辑「${role.name}」。请输入要修改的字段：名称、简介、提示词。`);
      return;
    }

    if (flow.step === "edit-field") {
      const field = normalizeField(value);
      if (!field) {
        await ctx.reply("请只输入：名称、简介 或 提示词。");
        return;
      }
      await set(scope, "edit-value", { ...flow.draft, field });
      const label = field === "name" ? "新名称" : field === "description" ? "新简介" : "新的 system prompt";
      await ctx.reply(field === "description" ? `请输入${label}；发送 - 可清空简介。` : `请输入${label}。`);
      return;
    }

    if (flow.step === "edit-value") {
      const target = await db.findOneAsync({ _id: flow.draft?.roleId, type: "role" });
      if (!target) {
        await clear(scope);
        await ctx.reply("这个角色已不存在，已退出管理模式。");
        return;
      }
      const field = flow.draft?.field;
      const update = { updatedAt: new Date().toISOString(), updatedBy: scope.userId };
      if (field === "name") {
        if (!isValidRoleName(value)) {
          await ctx.reply("角色名称不能为空且不能超过 64 个字符，请重新输入。");
          return;
        }
        const duplicate = findRole(await getRoles(), value);
        if (duplicate && duplicate.id !== target._id) {
          await ctx.reply("已存在同名角色，请换一个名称。");
          return;
        }
        update.name = value;
        update.nameKey = value.toLocaleLowerCase();
      } else if (field === "description") {
        update.description = value === "-" ? "" : value;
      } else if (field === "systemPrompt") {
        if (!value) {
          await ctx.reply("System prompt 不能为空，请重新输入。");
          return;
        }
        update.systemPrompt = value;
      } else {
        await clear(scope);
        await ctx.reply("管理状态无效，已退出。请重新发送 /admin。");
        return;
      }
      await db.updateAsync({ _id: target._id }, { $set: update });
      await clear(scope);
      await ctx.reply(`已更新角色「${update.name || target.name}」。已开始的对话会继续使用原有 prompt；重新 /newchat 后才会使用新设定。`);
      return;
    }

    if (flow.step === "delete-select") {
      const role = findRole(await getRoles(), value);
      if (!role?.id) {
        await ctx.reply("没有找到该角色，请重新输入角色名称。");
        return;
      }
      await set(scope, "delete-confirm", { roleId: role.id, roleName: role.name });
      await ctx.reply(`将删除「${role.name}」。请输入“确认删除”继续；发送 取消 可保留角色。`);
      return;
    }

    if (flow.step === "delete-confirm") {
      if (value !== "确认删除") {
        await ctx.reply("尚未删除。请输入“确认删除”继续，或发送 取消 退出。");
        return;
      }
      const removedCount = await db.removeAsync({ _id: flow.draft?.roleId, type: "role" }, {});
      await clear(scope);
      await ctx.reply(removedCount > 0 ? `已删除角色「${flow.draft?.roleName}」。已开始的对话不受影响。` : "角色已不存在，无需删除。");
      return;
    }

    await clear(scope);
    await ctx.reply("管理状态无效，已退出。请重新发送 /admin。");
  }

  return { clear, find, handle, menu, set };
}

module.exports = { createAdminFlow };
