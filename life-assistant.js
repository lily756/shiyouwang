const MAX_TEXT_LENGTH = 1_000;
const REMINDER_INTERVAL_MS = 60_000;
const HABIT_CHECK_INTERVAL_MS = 15 * 60_000;
const LIFE_CATEGORIES = new Set([
  "note",
  "medication",
  "exercise",
  "sleep",
  "feeding",
  "weight",
  "meal",
  "other",
]);
const MONITOR_CATEGORIES = new Set([
  "medication",
  "exercise",
  "sleep",
  "inventory",
]);
const DEFAULT_PERSONAL_SETTINGS = Object.freeze({
  timezone: "Asia/Shanghai",
  proactiveEnabled: false,
  monitorCategories: [],
  quietStart: "22:00",
  quietEnd: "08:00",
});
const BILL_ENTRY_TYPES = new Set(["expense", "income"]);
const BILL_CATEGORIES = new Set([
  "food",
  "transport",
  "shopping",
  "housing",
  "health",
  "entertainment",
  "education",
  "other",
]);
const DEFAULT_BILL_SETTINGS = Object.freeze({
  settlementDay: 1,
  currency: "CNY",
});

function createLifeAssistant({ db, bot }) {
  let schedulerTimer;
  let lastHabitCheckAt = 0;

  function getScope(ctx) {
    const chatId =
      ctx.chat?.id ?? ctx.message?.chat?.id ?? ctx.editedMessage?.chat?.id;
    const userId =
      ctx.from?.id ?? ctx.message?.from?.id ?? ctx.editedMessage?.from?.id;

    if (chatId === undefined || userId === undefined) {
      return null;
    }

    return { chatId, userId };
  }

  function getPrivateScope(ctx) {
    const scope = getScope(ctx);
    if (!scope || ctx.chat?.type !== "private") {
      return null;
    }

    return scope;
  }

  function trimText(value, maximum = MAX_TEXT_LENGTH) {
    return typeof value === "string" ? value.trim().slice(0, maximum) : "";
  }

  function normalizeName(value) {
    return trimText(value, 128).toLocaleLowerCase();
  }

  function normalizeStringList(value, maximum = 8) {
    if (!Array.isArray(value)) {
      return [];
    }

    return [...new Set(value.map((item) => trimText(item, 80)).filter(Boolean))].slice(
      0,
      maximum,
    );
  }

  function normalizeMonitorCategories(value) {
    return normalizeStringList(value, 8).filter((category) =>
      MONITOR_CATEGORIES.has(category),
    );
  }

  function parseDate(value, fallback = null) {
    if (value === undefined || value === null || value === "") {
      return fallback;
    }

    const date = new Date(value);
    return Number.isNaN(date.valueOf()) ? null : date;
  }

  function toIso(value, fallback = null) {
    const date = parseDate(value, fallback);
    return date ? date.toISOString() : null;
  }

  function clampInteger(value, fallback, minimum, maximum) {
    const number = Number(value);
    if (!Number.isFinite(number)) {
      return fallback;
    }
    return Math.min(maximum, Math.max(minimum, Math.floor(number)));
  }

  function hasValidTimeZone(timezone) {
    if (typeof timezone !== "string" || !timezone.trim()) {
      return false;
    }

    try {
      new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format();
      return true;
    } catch {
      return false;
    }
  }

  function dateKey(date, timeZone) {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(date);
    const fields = Object.fromEntries(
      parts
        .filter((part) => part.type !== "literal")
        .map((part) => [part.type, part.value]),
    );
    return `${fields.year}-${fields.month}-${fields.day}`;
  }

  function dateParts(date, timeZone) {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(date);
    const fields = Object.fromEntries(
      parts
        .filter((part) => part.type !== "literal")
        .map((part) => [part.type, part.value]),
    );
    return {
      year: Number(fields.year),
      month: Number(fields.month),
      day: Number(fields.day),
    };
  }

  function makeDateKey(year, month, day) {
    return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }

  function daysInMonth(year, month) {
    return new Date(Date.UTC(year, month, 0)).getUTCDate();
  }

  function shiftMonth(year, month, offset) {
    const total = year * 12 + (month - 1) + offset;
    return {
      year: Math.floor(total / 12),
      month: (total % 12) + 1,
    };
  }

  function normalizeCurrency(value) {
    const currency = trimText(value, 8).toUpperCase();
    return /^[A-Z]{3}$/.test(currency) ? currency : DEFAULT_BILL_SETTINGS.currency;
  }

  function getCycleDay(year, month, settlementDay) {
    return Math.min(settlementDay, daysInMonth(year, month));
  }

  function getBillCycleStartKey(date, timezone, settlementDay) {
    const current = dateParts(date, timezone);
    const currentCycleDay = getCycleDay(current.year, current.month, settlementDay);
    const cycleMonth = current.day >= currentCycleDay
      ? current
      : shiftMonth(current.year, current.month, -1);
    return makeDateKey(
      cycleMonth.year,
      cycleMonth.month,
      getCycleDay(cycleMonth.year, cycleMonth.month, settlementDay),
    );
  }

  function getNextBillCycleStartKey(startDateKey, settlementDay) {
    const [year, month] = String(startDateKey).split("-").map(Number);
    const next = shiftMonth(year, month, 1);
    return makeDateKey(
      next.year,
      next.month,
      getCycleDay(next.year, next.month, settlementDay),
    );
  }

  function getTimeInMinutes(date, timeZone) {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone,
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(date);
    const fields = Object.fromEntries(
      parts
        .filter((part) => part.type !== "literal")
        .map((part) => [part.type, part.value]),
    );
    return Number(fields.hour) * 60 + Number(fields.minute);
  }

  function timeToMinutes(value, fallback) {
    const match = /^(\d{1,2}):(\d{2})$/.exec(value || "");
    if (!match) {
      return fallback;
    }

    const hour = Number(match[1]);
    const minute = Number(match[2]);
    if (hour > 23 || minute > 59) {
      return fallback;
    }
    return hour * 60 + minute;
  }

  function isQuietHours(settings, now = new Date()) {
    const current = getTimeInMinutes(now, settings.timezone);
    const start = timeToMinutes(settings.quietStart, 22 * 60);
    const end = timeToMinutes(settings.quietEnd, 8 * 60);

    return start < end
      ? current >= start && current < end
      : current >= start || current < end;
  }

  async function getPersonalSettings(scope) {
    const saved = await db.findOneAsync({ type: "life-settings", userId: scope.userId });
    const timezone = hasValidTimeZone(saved?.timezone)
      ? saved.timezone
      : DEFAULT_PERSONAL_SETTINGS.timezone;

    return {
      ...DEFAULT_PERSONAL_SETTINGS,
      ...(saved || {}),
      timezone,
      monitorCategories: normalizeMonitorCategories(saved?.monitorCategories),
      chatId: scope.chatId,
      userId: scope.userId,
    };
  }

  async function savePersonalSettings(scope, updates) {
    const current = await db.findOneAsync({ type: "life-settings", userId: scope.userId });
    const settings = {
      ...(await getPersonalSettings(scope)),
      ...updates,
      timezone: hasValidTimeZone(updates.timezone)
        ? updates.timezone
        : (await getPersonalSettings(scope)).timezone,
      updatedAt: new Date().toISOString(),
    };

    if (current) {
      await db.updateAsync(
        { _id: current._id },
        { $set: settings },
      );
      return settings;
    }

    await db.insertAsync({
      type: "life-settings",
      userId: scope.userId,
      chatId: scope.chatId,
      createdAt: settings.updatedAt,
      ...settings,
    });
    return settings;
  }

  async function getBillSettings(scope) {
    const saved = await db.findOneAsync({ type: "bill-settings", userId: scope.userId });
    const settlementDay = clampInteger(
      saved?.settlementDay,
      DEFAULT_BILL_SETTINGS.settlementDay,
      1,
      31,
    );
    const personalSettings = await getPersonalSettings(scope);

    return {
      settlementDay,
      currency: normalizeCurrency(saved?.currency),
      lastCycleStartKey: typeof saved?.lastCycleStartKey === "string"
        ? saved.lastCycleStartKey
        : getBillCycleStartKey(new Date(), personalSettings.timezone, settlementDay),
      timezone: personalSettings.timezone,
      chatId: scope.chatId,
      userId: scope.userId,
    };
  }

  async function saveBillSettings(scope, updates = {}) {
    const existing = await db.findOneAsync({ type: "bill-settings", userId: scope.userId });
    const current = await getBillSettings(scope);
    const settlementDay = clampInteger(
      updates.settlementDay ?? current.settlementDay,
      DEFAULT_BILL_SETTINGS.settlementDay,
      1,
      31,
    );
    const timezone = current.timezone;
    const now = new Date().toISOString();
    const settings = {
      userId: scope.userId,
      chatId: scope.chatId,
      settlementDay,
      currency: normalizeCurrency(updates.currency ?? current.currency),
      lastCycleStartKey: updates.lastCycleStartKey || current.lastCycleStartKey ||
        getBillCycleStartKey(new Date(), timezone, settlementDay),
      updatedAt: now,
    };

    if (existing) {
      await db.updateAsync({ _id: existing._id }, { $set: settings });
    } else {
      await db.insertAsync({
        type: "bill-settings",
        ...settings,
        createdAt: now,
      });
    }

    return { ...settings, timezone };
  }

  function normalizeMoneyCents(value) {
    const amount = Number(value);
    if (!Number.isFinite(amount) || amount <= 0 || amount > 100_000_000) {
      return null;
    }

    const cents = Math.round(amount * 100);
    return Number.isSafeInteger(cents) && cents > 0 ? cents : null;
  }

  function amountFromCents(cents) {
    return Number((Number(cents || 0) / 100).toFixed(2));
  }

  function getPreviousBillCycleStartKey(currentStartKey, settlementDay) {
    const [year, month] = String(currentStartKey).split("-").map(Number);
    const previous = shiftMonth(year, month, -1);
    return makeDateKey(
      previous.year,
      previous.month,
      getCycleDay(previous.year, previous.month, settlementDay),
    );
  }

  async function getBillEntriesForRange(scope, settings, startDateKey, endDateKey = null) {
    const entries = await db.findAsync({ type: "bill-entry", userId: scope.userId });
    return entries.filter((entry) => {
      const occurredAt = parseDate(entry.occurredAt);
      if (!occurredAt || entry.currency !== settings.currency) {
        return false;
      }
      const key = dateKey(occurredAt, settings.timezone);
      return key >= startDateKey && (!endDateKey || key < endDateKey);
    });
  }

  function summarizeBillEntries(entries, currency) {
    let expenseCents = 0;
    let incomeCents = 0;
    const categoryTotals = new Map();

    for (const entry of entries) {
      const cents = Number(entry.amountCents);
      if (!Number.isSafeInteger(cents) || cents <= 0) {
        continue;
      }
      if (entry.entryType === "income") {
        incomeCents += cents;
      } else {
        expenseCents += cents;
        categoryTotals.set(entry.category, (categoryTotals.get(entry.category) || 0) + cents);
      }
    }

    return {
      currency,
      entryCount: entries.length,
      expense: amountFromCents(expenseCents),
      income: amountFromCents(incomeCents),
      net: amountFromCents(incomeCents - expenseCents),
      expenseCents,
      incomeCents,
      netCents: incomeCents - expenseCents,
      categories: [...categoryTotals.entries()]
        .sort((left, right) => right[1] - left[1])
        .map(([category, cents]) => ({ category, amount: amountFromCents(cents), amountCents: cents })),
    };
  }

  async function setBillCycleDay(scope, args) {
    const rawDay = Number(args.settlement_day);
    const requestedCurrency = args.currency === undefined
      ? null
      : trimText(args.currency, 8).toUpperCase();
    if (!Number.isInteger(rawDay) || rawDay < 1 || rawDay > 31) {
      return { ok: false, error: "结算日应为每月 1 到 31 日。" };
    }
    if (requestedCurrency && !/^[A-Z]{3}$/.test(requestedCurrency)) {
      return { ok: false, error: "货币应使用三位 ISO 代码，例如 CNY。" };
    }

    const timezone = (await getPersonalSettings(scope)).timezone;
    const cycleStartDate = getBillCycleStartKey(new Date(), timezone, rawDay);
    const settings = await saveBillSettings(scope, {
      settlementDay: rawDay,
      ...(requestedCurrency ? { currency: requestedCurrency } : {}),
      // Changing the cycle day starts a new logical cycle now; past entries remain intact.
      lastCycleStartKey: cycleStartDate,
    });

    return {
      ok: true,
      settlementDay: settings.settlementDay,
      currency: settings.currency,
      cycleStartDate,
      message: `已设为每月 ${settings.settlementDay} 日结算。到结算日会自动归档本期账单，流水不会删除。`,
    };
  }

  async function recordBillEntry(scope, args) {
    const entryType = trimText(args.entry_type, 20);
    const category = trimText(args.category, 40);
    const description = trimText(args.description, 500);
    const amountCents = normalizeMoneyCents(args.amount);
    const occurredAt = toIso(args.occurred_at, new Date());
    const requestedCurrency = args.currency === undefined
      ? null
      : trimText(args.currency, 8).toUpperCase();

    if (!BILL_ENTRY_TYPES.has(entryType) || !BILL_CATEGORIES.has(category)) {
      return { ok: false, error: "账目类型或分类无效。" };
    }
    if (!description || !amountCents || !occurredAt) {
      return { ok: false, error: "金额、说明或发生时间无效。" };
    }
    if (requestedCurrency && !/^[A-Z]{3}$/.test(requestedCurrency)) {
      return { ok: false, error: "货币应使用三位 ISO 代码，例如 CNY。" };
    }

    const settings = await saveBillSettings(scope);
    if (requestedCurrency && requestedCurrency !== settings.currency) {
      return {
        ok: false,
        error: `当前账单货币为 ${settings.currency}；请先在设置结算日时切换账单货币，避免不同货币混算。`,
      };
    }
    const currency = settings.currency;
    const now = new Date().toISOString();
    const entry = await db.insertAsync({
      type: "bill-entry",
      userId: scope.userId,
      chatId: scope.chatId,
      entryType,
      category,
      description,
      amountCents,
      currency,
      occurredAt,
      createdAt: now,
    });

    await db.insertAsync({
      type: "timeline-event",
      userId: scope.userId,
      chatId: scope.chatId,
      category: "billing",
      summary: `记账：${entryType === "expense" ? "支出" : "收入"} ${amountFromCents(amountCents)} ${currency} · ${description}`,
      occurredAt,
      sourceType: "bill-entry",
      sourceId: entry._id,
      createdAt: now,
    });

    return {
      ok: true,
      entryId: entry._id,
      entryType,
      category,
      description,
      amount: amountFromCents(amountCents),
      currency,
      occurredAt,
      message: "已记入账单，并写入时间轴。",
    };
  }

  async function getBillSummary(scope, args) {
    const period = trimText(args.period, 20) || "current";
    if (!new Set(["current", "previous"]).has(period)) {
      return { ok: false, error: "账单周期仅支持 current 或 previous。" };
    }

    const settings = await getBillSettings(scope);
    const currentStartKey = getBillCycleStartKey(
      new Date(),
      settings.timezone,
      settings.settlementDay,
    );
    const startDateKey = period === "previous"
      ? getPreviousBillCycleStartKey(currentStartKey, settings.settlementDay)
      : currentStartKey;
    const endDateKey = period === "previous" ? currentStartKey : null;
    const entries = await getBillEntriesForRange(scope, settings, startDateKey, endDateKey);
    const summary = summarizeBillEntries(entries, settings.currency);

    return {
      ok: true,
      period,
      settlementDay: settings.settlementDay,
      cycleStartDate: startDateKey,
      cycleEndExclusiveDate: endDateKey,
      ...summary,
      recentEntries: entries
        .sort((left, right) => String(right.occurredAt).localeCompare(String(left.occurredAt)))
        .slice(0, 20)
        .map((entry) => ({
          entryType: entry.entryType,
          category: entry.category,
          description: entry.description,
          amount: amountFromCents(entry.amountCents),
          occurredAt: entry.occurredAt,
        })),
    };
  }

  async function getBillHistory(scope, args) {
    await archiveClosedBillCycles();
    const limit = clampInteger(args.limit, 6, 1, 24);
    const archives = await db.findAsync({ type: "bill-cycle-archive", userId: scope.userId });
    const periods = archives
      .sort((left, right) => String(right.cycleStartDate).localeCompare(String(left.cycleStartDate)))
      .slice(0, limit)
      .map((archive) => ({
        cycleStartDate: archive.cycleStartDate,
        cycleEndExclusiveDate: archive.cycleEndExclusiveDate,
        settlementDay: archive.settlementDay,
        currency: archive.currency,
        entryCount: archive.entryCount,
        expense: amountFromCents(archive.expenseCents),
        income: amountFromCents(archive.incomeCents),
        net: amountFromCents(archive.netCents),
        categories: archive.categories || [],
      }));

    return { ok: true, periods };
  }

  async function archiveClosedBillCycles() {
    const storedSettings = await db.findAsync({ type: "bill-settings" });

    for (const stored of storedSettings) {
      if (stored.userId === undefined || stored.chatId === undefined) {
        continue;
      }
      const scope = { userId: stored.userId, chatId: stored.chatId };
      const settings = await getBillSettings(scope);
      const currentStartKey = getBillCycleStartKey(
        new Date(),
        settings.timezone,
        settings.settlementDay,
      );
      let cursor = settings.lastCycleStartKey;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(cursor) || cursor >= currentStartKey) {
        if (cursor !== currentStartKey) {
          await saveBillSettings(scope, { lastCycleStartKey: currentStartKey });
        }
        continue;
      }

      let cycleCount = 0;
      while (cursor < currentStartKey && cycleCount < 24) {
        const nextCursor = getNextBillCycleStartKey(cursor, settings.settlementDay);
        const existingArchive = await db.findOneAsync({
          type: "bill-cycle-archive",
          userId: scope.userId,
          cycleStartDate: cursor,
          settlementDay: settings.settlementDay,
          currency: settings.currency,
        });
        if (!existingArchive) {
          const entries = await getBillEntriesForRange(scope, settings, cursor, nextCursor);
          const summary = summarizeBillEntries(entries, settings.currency);
          await db.insertAsync({
            type: "bill-cycle-archive",
            userId: scope.userId,
            chatId: scope.chatId,
            cycleStartDate: cursor,
            cycleEndExclusiveDate: nextCursor,
            settlementDay: settings.settlementDay,
            currency: settings.currency,
            entryCount: summary.entryCount,
            expenseCents: summary.expenseCents,
            incomeCents: summary.incomeCents,
            netCents: summary.netCents,
            categories: summary.categories,
            archivedAt: new Date().toISOString(),
          });
        }
        cursor = nextCursor;
        cycleCount += 1;
      }

      await saveBillSettings(scope, {
        // Limit each tick to avoid long scheduler stalls; continue catch-up next tick.
        lastCycleStartKey: cursor,
      });
    }
  }

  async function createLifeRecord(scope, args) {
    const category = trimText(args.category, 40);
    const summary = trimText(args.summary);
    const occurredAt = toIso(args.occurred_at, new Date());

    if (!LIFE_CATEGORIES.has(category)) {
      return { ok: false, error: "不支持的记录分类。" };
    }
    if (!summary || !occurredAt) {
      return { ok: false, error: "记录内容或发生时间无效。" };
    }

    const numericValue = Number(args.value);
    const value = Number.isFinite(numericValue) ? numericValue : undefined;
    const now = new Date().toISOString();
    const record = await db.insertAsync({
      type: "life-record",
      userId: scope.userId,
      chatId: scope.chatId,
      category,
      summary,
      occurredAt,
      ...(value !== undefined ? { value } : {}),
      ...(trimText(args.unit, 40) ? { unit: trimText(args.unit, 40) } : {}),
      tags: normalizeStringList(args.tags),
      createdAt: now,
    });

    await db.insertAsync({
      type: "timeline-event",
      userId: scope.userId,
      chatId: scope.chatId,
      category,
      summary,
      occurredAt,
      sourceType: "life-record",
      sourceId: record._id,
      createdAt: now,
    });

    return {
      ok: true,
      recordId: record._id,
      category,
      occurredAt,
      message: "已记录，并写入时间轴。",
    };
  }

  async function createTodo(scope, args) {
    const title = trimText(args.title, 240);
    const dueAt = toIso(args.due_at);

    if (!title || (args.due_at && !dueAt)) {
      return { ok: false, error: "待办标题或截止时间无效。" };
    }

    const now = new Date().toISOString();
    const todo = await db.insertAsync({
      type: "todo",
      userId: scope.userId,
      chatId: scope.chatId,
      title,
      titleKey: title.toLocaleLowerCase(),
      status: "open",
      ...(dueAt ? { dueAt } : {}),
      createdAt: now,
      updatedAt: now,
    });

    return { ok: true, todoId: todo._id, title, dueAt: dueAt || null };
  }

  async function listTodayTodos(scope) {
    const settings = await getPersonalSettings(scope);
    const today = dateKey(new Date(), settings.timezone);
    const todos = await db.findAsync({ type: "todo", userId: scope.userId, status: "open" });
    const selected = todos
      .filter((todo) => !todo.dueAt || dateKey(new Date(todo.dueAt), settings.timezone) === today)
      .sort((left, right) => String(left.dueAt || "9999").localeCompare(String(right.dueAt || "9999")))
      .slice(0, 30)
      .map((todo) => ({ title: todo.title, dueAt: todo.dueAt || null }));

    return { ok: true, date: today, todos: selected };
  }

  async function completeTodo(scope, args) {
    const titleKey = normalizeName(args.title);
    if (!titleKey) {
      return { ok: false, error: "请提供待办标题。" };
    }

    const todos = await db.findAsync({ type: "todo", userId: scope.userId, status: "open" });
    const todo = todos.find((item) => item.titleKey === titleKey) ||
      todos.find((item) => item.titleKey.includes(titleKey));

    if (!todo) {
      return { ok: false, error: "没有找到未完成的同名待办。" };
    }

    const completedAt = new Date().toISOString();
    await db.updateAsync(
      { _id: todo._id },
      { $set: { status: "done", completedAt, updatedAt: completedAt } },
    );
    return { ok: true, title: todo.title, completedAt };
  }

  async function createReminder(scope, args) {
    const message = trimText(args.message, 500);
    const dueAt = toIso(args.due_at);

    if (!message || !dueAt) {
      return { ok: false, error: "提醒内容或提醒时间无效。请提供 ISO 8601 时间。" };
    }

    const reminder = await db.insertAsync({
      type: "reminder",
      userId: scope.userId,
      chatId: scope.chatId,
      message,
      dueAt,
      status: "pending",
      createdAt: new Date().toISOString(),
    });
    return { ok: true, reminderId: reminder._id, dueAt, message };
  }

  async function createCalendarEvent(scope, args) {
    const title = trimText(args.title, 240);
    const startsAt = toIso(args.starts_at);
    const endsAt = toIso(args.ends_at);
    const remindAt = toIso(args.remind_at);

    if (!title || !startsAt || (args.ends_at && !endsAt) || (args.remind_at && !remindAt)) {
      return { ok: false, error: "日程标题、开始时间或提醒时间无效。" };
    }

    const now = new Date().toISOString();
    const event = await db.insertAsync({
      type: "timeline-event",
      userId: scope.userId,
      chatId: scope.chatId,
      category: "calendar",
      summary: title,
      occurredAt: startsAt,
      ...(endsAt ? { endsAt } : {}),
      sourceType: "calendar-event",
      createdAt: now,
    });

    let reminderId = null;
    if (remindAt) {
      const reminder = await db.insertAsync({
        type: "reminder",
        userId: scope.userId,
        chatId: scope.chatId,
        message: `日程提醒：${title}`,
        dueAt: remindAt,
        status: "pending",
        sourceType: "calendar-event",
        sourceId: event._id,
        createdAt: now,
      });
      reminderId = reminder._id;
    }

    return { ok: true, eventId: event._id, title, startsAt, reminderId };
  }

  async function getTimeline(scope, args) {
    const days = clampInteger(args.days, 7, 1, 90);
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1_000).toISOString();
    const events = await db.findAsync({ type: "timeline-event", userId: scope.userId });
    const timeline = events
      .filter((event) => event.occurredAt >= cutoff)
      .sort((left, right) => String(right.occurredAt).localeCompare(String(left.occurredAt)))
      .slice(0, 50)
      .map((event) => ({
        category: event.category,
        summary: event.summary,
        occurredAt: event.occurredAt,
      }));

    return { ok: true, days, timeline };
  }

  async function saveContextMemory(scope, args) {
    const topic = trimText(args.topic, 160);
    const summary = trimText(args.summary);
    const nextStep = trimText(args.next_step, 500);
    const pausedReason = trimText(args.paused_reason, 500);

    if (!topic || !summary) {
      return { ok: false, error: "项目/主题和上下文摘要不能为空。" };
    }

    const topicKey = topic.toLocaleLowerCase();
    const existing = await db.findOneAsync({
      type: "context-memory",
      userId: scope.userId,
      topicKey,
    });
    const memory = {
      topic,
      topicKey,
      summary,
      ...(nextStep ? { nextStep } : {}),
      ...(pausedReason ? { pausedReason } : {}),
      tags: normalizeStringList(args.tags),
      updatedAt: new Date().toISOString(),
    };

    if (existing) {
      await db.updateAsync({ _id: existing._id }, { $set: memory });
      return { ok: true, memoryId: existing._id, updated: true, topic };
    }

    const created = await db.insertAsync({
      type: "context-memory",
      userId: scope.userId,
      chatId: scope.chatId,
      ...memory,
      createdAt: memory.updatedAt,
    });
    return { ok: true, memoryId: created._id, updated: false, topic };
  }

  async function searchContextMemory(scope, args) {
    const query = normalizeName(args.query);
    const memories = await db.findAsync({ type: "context-memory", userId: scope.userId });
    const terms = query.split(/\s+/).filter(Boolean);
    const selected = memories
      .filter((memory) => {
        if (terms.length === 0) {
          return true;
        }
        const haystack = [
          memory.topic,
          memory.summary,
          memory.nextStep,
          memory.pausedReason,
          ...(memory.tags || []),
        ]
          .filter(Boolean)
          .join(" ")
          .toLocaleLowerCase();
        return terms.every((term) => haystack.includes(term));
      })
      .sort((left, right) => String(right.updatedAt).localeCompare(String(left.updatedAt)))
      .slice(0, 10)
      .map((memory) => ({
        topic: memory.topic,
        summary: memory.summary,
        nextStep: memory.nextStep || null,
        pausedReason: memory.pausedReason || null,
        updatedAt: memory.updatedAt,
      }));

    return { ok: true, memories: selected };
  }

  async function upsertInventoryItem(scope, args) {
    const name = trimText(args.name, 160);
    const quantity = Number(args.quantity);
    const unit = trimText(args.unit, 40) || "件";
    const location = trimText(args.location, 160);
    const expiresAt = toIso(args.expires_at);

    if (!name || !Number.isFinite(quantity) || (args.expires_at && !expiresAt)) {
      return { ok: false, error: "物品名称、库存数量或保质期无效。" };
    }

    const nameKey = name.toLocaleLowerCase();
    const existing = await db.findOneAsync({
      type: "inventory-item",
      userId: scope.userId,
      nameKey,
    });
    const item = {
      name,
      nameKey,
      quantity,
      unit,
      ...(location ? { location } : {}),
      ...(expiresAt ? { expiresAt } : {}),
      updatedAt: new Date().toISOString(),
    };

    if (existing) {
      await db.updateAsync({ _id: existing._id }, { $set: item });
      return { ok: true, updated: true, item };
    }

    const created = await db.insertAsync({
      type: "inventory-item",
      userId: scope.userId,
      chatId: scope.chatId,
      ...item,
      createdAt: item.updatedAt,
    });
    return { ok: true, updated: false, item: { ...item, id: created._id } };
  }

  async function checkInventory(scope, args) {
    const query = normalizeName(args.query);
    const items = await db.findAsync({ type: "inventory-item", userId: scope.userId });
    const selected = items
      .filter((item) => !query || item.nameKey.includes(query) || query.includes(item.nameKey))
      .sort((left, right) => String(left.name).localeCompare(String(right.name), "zh-Hans-CN"))
      .slice(0, 20)
      .map((item) => ({
        name: item.name,
        quantity: item.quantity,
        unit: item.unit,
        location: item.location || null,
        expiresAt: item.expiresAt || null,
      }));

    return { ok: true, items: selected };
  }

  async function searchLifeRecords(scope, args) {
    const query = normalizeName(args.query);
    const category = trimText(args.category, 40);
    const days = clampInteger(args.days, 30, 1, 365);
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1_000).toISOString();

    if (category && !LIFE_CATEGORIES.has(category)) {
      return { ok: false, error: "不支持的记录分类。" };
    }

    const records = await db.findAsync({ type: "life-record", userId: scope.userId });
    const terms = query.split(/\s+/).filter(Boolean);
    const selected = records
      .filter((record) => record.occurredAt >= cutoff)
      .filter((record) => !category || record.category === category)
      .filter((record) => {
        if (terms.length === 0) {
          return true;
        }
        const haystack = [record.summary, record.category, ...(record.tags || [])]
          .join(" ")
          .toLocaleLowerCase();
        return terms.every((term) => haystack.includes(term));
      })
      .sort((left, right) => String(right.occurredAt).localeCompare(String(left.occurredAt)))
      .slice(0, 20)
      .map((record) => ({
        category: record.category,
        summary: record.summary,
        occurredAt: record.occurredAt,
        value: record.value ?? null,
        unit: record.unit || null,
      }));

    return { ok: true, days, records: selected };
  }

  async function getLifeSummary(scope, args) {
    const category = trimText(args.category, 40);
    const days = clampInteger(args.days, 14, 1, 365);
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1_000).toISOString();

    if (category && !LIFE_CATEGORIES.has(category)) {
      return { ok: false, error: "不支持的记录分类。" };
    }

    const records = (await db.findAsync({ type: "life-record", userId: scope.userId }))
      .filter((record) => record.occurredAt >= cutoff)
      .filter((record) => !category || record.category === category)
      .sort((left, right) => String(left.occurredAt).localeCompare(String(right.occurredAt)));
    const numericRecords = records.filter((record) => Number.isFinite(record.value));
    const values = numericRecords.map((record) => record.value);
    const average = values.length
      ? values.reduce((total, value) => total + value, 0) / values.length
      : null;
    const change = values.length >= 2 ? values.at(-1) - values[0] : null;

    return {
      ok: true,
      category: category || "all",
      days,
      count: records.length,
      average,
      change,
      unit: numericRecords[0]?.unit || null,
      records: records.slice(-20).map((record) => ({
        category: record.category,
        summary: record.summary,
        occurredAt: record.occurredAt,
        value: record.value ?? null,
        unit: record.unit || null,
      })),
    };
  }

  async function setProactiveMode(scope, args) {
    const enabled = Boolean(args.enabled);
    const timezone = trimText(args.timezone, 80);
    if (timezone && !hasValidTimeZone(timezone)) {
      return { ok: false, error: "无效的 IANA 时区。" };
    }

    const current = await getPersonalSettings(scope);
    const monitorCategories = Array.isArray(args.monitor_categories)
      ? normalizeMonitorCategories(args.monitor_categories)
      : current.monitorCategories;
    const settings = await savePersonalSettings(scope, {
      proactiveEnabled: enabled,
      monitorCategories,
      ...(timezone ? { timezone } : {}),
    });

    return {
      ok: true,
      proactiveEnabled: settings.proactiveEnabled,
      monitorCategories: settings.monitorCategories,
      timezone: settings.timezone,
      quietHours: `${settings.quietStart}-${settings.quietEnd}`,
    };
  }

  async function savePlace(scope, args) {
    const name = trimText(args.name, 160);
    const placeType = trimText(args.place_type, 80) || "place";
    const radiusMeters = clampInteger(args.radius_meters, 200, 50, 2_000);
    const location = await db.findOneAsync({ type: "user-location", userId: scope.userId });

    if (!name) {
      return { ok: false, error: "地点名称不能为空。" };
    }
    if (!location) {
      return { ok: false, error: "请先在 Telegram 中向机器人发送当前位置，再保存地点。" };
    }

    const nameKey = name.toLocaleLowerCase();
    const existing = await db.findOneAsync({
      type: "saved-place",
      userId: scope.userId,
      nameKey,
    });
    const place = {
      name,
      nameKey,
      placeType,
      radiusMeters,
      latitude: location.latitude,
      longitude: location.longitude,
      updatedAt: new Date().toISOString(),
    };

    if (existing) {
      await db.updateAsync({ _id: existing._id }, { $set: place });
      return { ok: true, updated: true, place: name };
    }

    await db.insertAsync({
      type: "saved-place",
      userId: scope.userId,
      chatId: scope.chatId,
      ...place,
      createdAt: place.updatedAt,
    });
    return { ok: true, updated: false, place: name };
  }

  function distanceInMeters(left, right) {
    const toRadians = (degrees) => (degrees * Math.PI) / 180;
    const radius = 6_371_000;
    const deltaLatitude = toRadians(right.latitude - left.latitude);
    const deltaLongitude = toRadians(right.longitude - left.longitude);
    const a =
      Math.sin(deltaLatitude / 2) ** 2 +
      Math.cos(toRadians(left.latitude)) *
        Math.cos(toRadians(right.latitude)) *
        Math.sin(deltaLongitude / 2) ** 2;
    return 2 * radius * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  async function sendProactiveNotification(scope, key, text, cooldownMs = 24 * 60 * 60 * 1_000) {
    const logs = await db.findAsync({
      type: "proactive-notification",
      userId: scope.userId,
      key,
    });
    const cutoff = Date.now() - cooldownMs;
    if (logs.some((log) => new Date(log.sentAt).valueOf() >= cutoff)) {
      return false;
    }

    try {
      await bot.telegram.sendMessage(scope.chatId, text);
      await db.insertAsync({
        type: "proactive-notification",
        userId: scope.userId,
        chatId: scope.chatId,
        key,
        sentAt: new Date().toISOString(),
      });
      return true;
    } catch (error) {
      console.error("发送主动提醒失败:", error);
      return false;
    }
  }

  async function checkNearbyInventory(scope, location) {
    const settings = await getPersonalSettings(scope);
    if (
      !settings.proactiveEnabled ||
      !settings.monitorCategories.includes("inventory") ||
      isQuietHours(settings)
    ) {
      return;
    }

    const [places, items] = await Promise.all([
      db.findAsync({ type: "saved-place", userId: scope.userId }),
      db.findAsync({ type: "inventory-item", userId: scope.userId }),
    ]);
    const nearbyPlace = places.find(
      (place) =>
        distanceInMeters(location, place) <= (place.radiusMeters || 200),
    );
    const outOfStock = items.filter((item) => Number(item.quantity) <= 0).slice(0, 5);

    if (!nearbyPlace || outOfStock.length === 0) {
      return;
    }

    const itemList = outOfStock.map((item) => item.name).join("、");
    await sendProactiveNotification(
      scope,
      `nearby-inventory:${nearbyPlace._id || nearbyPlace.nameKey}`,
      `你在「${nearbyPlace.name}」附近，${itemList} 库存为 0，要不要顺便买？`,
      8 * 60 * 60 * 1_000,
    );
  }

  async function handleLocation(ctx) {
    const scope = getPrivateScope(ctx);
    const location = ctx.message?.location ?? ctx.editedMessage?.location;

    if (!scope || !location) {
      if (ctx.chat?.type !== "private") {
        await ctx.reply("为保护隐私，请在与机器人的私聊中分享位置。");
      }
      return;
    }

    const latitude = Number(location.latitude);
    const longitude = Number(location.longitude);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      await ctx.reply("收到的位置无效，请重新发送。");
      return;
    }

    const now = new Date().toISOString();
    const existing = await db.findOneAsync({ type: "user-location", userId: scope.userId });
    const savedLocation = { latitude, longitude, updatedAt: now, chatId: scope.chatId };

    if (existing) {
      await db.updateAsync({ _id: existing._id }, { $set: savedLocation });
    } else {
      await db.insertAsync({
        type: "user-location",
        userId: scope.userId,
        ...savedLocation,
        createdAt: now,
      });
    }

    await ctx.reply("已更新当前位置。若要把这里设为超市等地点，请直接告诉我“把这里记为 XX 超市”。");
    await checkNearbyInventory(scope, { latitude, longitude });
  }

  async function dispatchDueReminders() {
    const now = new Date().toISOString();
    const reminders = await db.findAsync({ type: "reminder", status: "pending" });

    for (const reminder of reminders.filter((item) => item.dueAt <= now)) {
      const updated = await db.updateAsync(
        { _id: reminder._id, status: "pending" },
        { $set: { status: "sending", sendingAt: now } },
      );
      if (!updated) {
        continue;
      }

      try {
        await bot.telegram.sendMessage(reminder.chatId, `提醒：${reminder.message}`);
        await db.updateAsync(
          { _id: reminder._id },
          { $set: { status: "sent", sentAt: new Date().toISOString() } },
        );
      } catch (error) {
        console.error("发送定时提醒失败:", error);
        await db.updateAsync(
          { _id: reminder._id },
          { $set: { status: "pending", lastErrorAt: new Date().toISOString() } },
        );
      }
    }
  }

  async function getLatestRecord(scope, category) {
    const records = await db.findAsync({
      type: "life-record",
      userId: scope.userId,
      category,
    });
    return records.sort((left, right) => String(right.occurredAt).localeCompare(String(left.occurredAt)))[0];
  }

  async function runHabitChecks() {
    const allSettings = await db.findAsync({ type: "life-settings", proactiveEnabled: true });
    const now = Date.now();

    for (const storedSettings of allSettings) {
      const scope = { chatId: storedSettings.chatId, userId: storedSettings.userId };
      const settings = await getPersonalSettings(scope);
      if (isQuietHours(settings)) {
        continue;
      }

      if (settings.monitorCategories.includes("medication")) {
        const latest = await getLatestRecord(scope, "medication");
        if (!latest || now - new Date(latest.occurredAt).valueOf() >= 3 * 24 * 60 * 60 * 1_000) {
          await sendProactiveNotification(
            scope,
            "habit:medication",
            "这几天没有看到用药记录。需要的话，记得按医嘱确认今天的药是否已服用。",
          );
        }
      }

      if (settings.monitorCategories.includes("exercise")) {
        const latest = await getLatestRecord(scope, "exercise");
        if (!latest || now - new Date(latest.occurredAt).valueOf() >= 3 * 24 * 60 * 60 * 1_000) {
          await sendProactiveNotification(
            scope,
            "habit:exercise",
            "已经几天没有运动记录了。如果方便，今天安排一次轻量活动怎么样？",
          );
        }
      }

      if (settings.monitorCategories.includes("sleep")) {
        const cutoff = new Date(now - 7 * 24 * 60 * 60 * 1_000).toISOString();
        const sleepRecords = (await db.findAsync({
          type: "life-record",
          userId: scope.userId,
          category: "sleep",
        }))
          .filter((record) => record.occurredAt >= cutoff && Number.isFinite(record.value))
          .sort((left, right) => String(right.occurredAt).localeCompare(String(left.occurredAt)))
          .slice(0, 3);
        const average = sleepRecords.length
          ? sleepRecords.reduce((total, record) => total + record.value, 0) / sleepRecords.length
          : null;

        if (sleepRecords.length >= 2 && average < 6) {
          await sendProactiveNotification(
            scope,
            "habit:sleep",
            "最近记录的睡眠时长偏少。今晚如果可以，试着给休息留出一点时间。",
          );
        }
      }
    }
  }

  function getToolDefinitions() {
    return [
      {
        type: "function",
        function: {
          name: "record_life_item",
          description: "把用户明确要求记录的一句话生活事件自动分类保存，并写入时间轴。",
          parameters: {
            type: "object",
            properties: {
              category: { type: "string", enum: [...LIFE_CATEGORIES] },
              summary: { type: "string" },
              occurred_at: { type: "string", description: "ISO 8601 时间；未指定时可省略。" },
              value: { type: "number", description: "可选数值，如睡眠小时数或体重。" },
              unit: { type: "string" },
              tags: { type: "array", items: { type: "string" } },
            },
            required: ["category", "summary"],
            additionalProperties: false,
          },
        },
      },
      {
        type: "function",
        function: {
          name: "record_bill_entry",
          description: "记录一笔个人收支，并同时写入 Timeline。用户明确说记账、花了/收入了多少钱时使用；由模型根据语义分类。",
          parameters: {
            type: "object",
            properties: {
              entry_type: { type: "string", enum: [...BILL_ENTRY_TYPES] },
              amount: { type: "number", minimum: 0.01, description: "正数金额，不要带货币符号。" },
              category: { type: "string", enum: [...BILL_CATEGORIES] },
              description: { type: "string", description: "这笔收支的简短说明。" },
              occurred_at: { type: "string", description: "可选 ISO 8601 时间；未说明则省略。" },
              currency: { type: "string", description: "可选三位货币代码，例如 CNY；默认使用账单货币。" },
            },
            required: ["entry_type", "amount", "category", "description"],
            additionalProperties: false,
          },
        },
      },
      {
        type: "function",
        function: {
          name: "set_bill_cycle_day",
          description: "设置用户每月账单结算/清账日。到该日会自动结转归档，历史流水不会删除；29–31 日在短月按该月最后一天结算。",
          parameters: {
            type: "object",
            properties: {
              settlement_day: { type: "integer", minimum: 1, maximum: 31 },
              currency: { type: "string", description: "可选三位账单货币代码，例如 CNY。" },
            },
            required: ["settlement_day"],
            additionalProperties: false,
          },
        },
      },
      {
        type: "function",
        function: {
          name: "get_bill_summary",
          description: "查询当前或上一个结算周期的账单汇总、分类支出及最近流水。用户问本期花了多少、本月账单、上期账单时使用。",
          parameters: {
            type: "object",
            properties: {
              period: { type: "string", enum: ["current", "previous"], description: "省略表示当前结算周期。" },
            },
            additionalProperties: false,
          },
        },
      },
      {
        type: "function",
        function: {
          name: "get_bill_history",
          description: "查询已结转的历史月度账单。用户问账单历史、过去几个月花费时使用。",
          parameters: {
            type: "object",
            properties: {
              limit: { type: "integer", minimum: 1, maximum: 24 },
            },
            additionalProperties: false,
          },
        },
      },
      {
        type: "function",
        function: {
          name: "create_todo",
          description: "创建 Today 待办。用户表达要做、待办或任务时使用。",
          parameters: {
            type: "object",
            properties: {
              title: { type: "string" },
              due_at: { type: "string", description: "可选 ISO 8601 截止时间。" },
            },
            required: ["title"],
            additionalProperties: false,
          },
        },
      },
      {
        type: "function",
        function: {
          name: "list_today_todos",
          description: "读取用户今天未完成的待办。用户询问今天待办、还要做什么时使用。",
          parameters: { type: "object", properties: {}, additionalProperties: false },
        },
      },
      {
        type: "function",
        function: {
          name: "complete_todo",
          description: "将指定标题的待办标记完成。",
          parameters: {
            type: "object",
            properties: { title: { type: "string" } },
            required: ["title"],
            additionalProperties: false,
          },
        },
      },
      {
        type: "function",
        function: {
          name: "create_reminder",
          description: "创建一次性 Telegram 定时提醒。使用前应先确认准确当前时间，due_at 必须是 ISO 8601 时间。",
          parameters: {
            type: "object",
            properties: {
              message: { type: "string" },
              due_at: { type: "string" },
            },
            required: ["message", "due_at"],
            additionalProperties: false,
          },
        },
      },
      {
        type: "function",
        function: {
          name: "create_calendar_event",
          description: "记录日程到时间轴，可选择创建 Telegram 提醒。",
          parameters: {
            type: "object",
            properties: {
              title: { type: "string" },
              starts_at: { type: "string" },
              ends_at: { type: "string" },
              remind_at: { type: "string" },
            },
            required: ["title", "starts_at"],
            additionalProperties: false,
          },
        },
      },
      {
        type: "function",
        function: {
          name: "get_timeline",
          description: "读取最近几天的 Timeline 时间轴。",
          parameters: {
            type: "object",
            properties: { days: { type: "integer", minimum: 1, maximum: 90 } },
            additionalProperties: false,
          },
        },
      },
      {
        type: "function",
        function: {
          name: "save_context_memory",
          description: "保存或更新项目/工作上下文，包括做到哪一步、下一步和暂停原因。仅在用户明确要求记住时使用。",
          parameters: {
            type: "object",
            properties: {
              topic: { type: "string" },
              summary: { type: "string" },
              next_step: { type: "string" },
              paused_reason: { type: "string" },
              tags: { type: "array", items: { type: "string" } },
            },
            required: ["topic", "summary"],
            additionalProperties: false,
          },
        },
      },
      {
        type: "function",
        function: {
          name: "search_context_memory",
          description: "检索之前保存的项目进度、下一步或暂停原因。",
          parameters: {
            type: "object",
            properties: { query: { type: "string" } },
            required: ["query"],
            additionalProperties: false,
          },
        },
      },
      {
        type: "function",
        function: {
          name: "upsert_inventory_item",
          description: "新增或更新家庭库存、存放位置和保质期。用户明确说明库存变化时使用。",
          parameters: {
            type: "object",
            properties: {
              name: { type: "string" },
              quantity: { type: "number" },
              unit: { type: "string" },
              location: { type: "string" },
              expires_at: { type: "string" },
            },
            required: ["name", "quantity"],
            additionalProperties: false,
          },
        },
      },
      {
        type: "function",
        function: {
          name: "check_inventory",
          description: "查询家里某种物品的库存、位置和保质期。",
          parameters: {
            type: "object",
            properties: { query: { type: "string" } },
            required: ["query"],
            additionalProperties: false,
          },
        },
      },
      {
        type: "function",
        function: {
          name: "search_life_records",
          description: "查询已记录的生活事件，例如上次给猫喂药、吃药或运动的时间。",
          parameters: {
            type: "object",
            properties: {
              query: { type: "string" },
              category: { type: "string", enum: [...LIFE_CATEGORIES] },
              days: { type: "integer", minimum: 1, maximum: 365 },
            },
            additionalProperties: false,
          },
        },
      },
      {
        type: "function",
        function: {
          name: "get_life_summary",
          description: "汇总一段时间内的记录和数值变化，例如最近两周体重变化或睡眠情况。",
          parameters: {
            type: "object",
            properties: {
              category: { type: "string", enum: [...LIFE_CATEGORIES] },
              days: { type: "integer", minimum: 1, maximum: 365 },
            },
            additionalProperties: false,
          },
        },
      },
      {
        type: "function",
        function: {
          name: "set_proactive_mode",
          description: "由用户明确同意后，开启或关闭低打扰主动提醒，并选择要关注的习惯类别。",
          parameters: {
            type: "object",
            properties: {
              enabled: { type: "boolean" },
              monitor_categories: {
                type: "array",
                items: { type: "string", enum: [...MONITOR_CATEGORIES] },
              },
              timezone: { type: "string" },
            },
            required: ["enabled"],
            additionalProperties: false,
          },
        },
      },
      {
        type: "function",
        function: {
          name: "save_place",
          description: "将用户刚刚分享的位置保存为超市等地点，用于库存位置提醒。只能在已收到位置后使用。",
          parameters: {
            type: "object",
            properties: {
              name: { type: "string" },
              place_type: { type: "string" },
              radius_meters: { type: "integer", minimum: 50, maximum: 2000 },
            },
            required: ["name"],
            additionalProperties: false,
          },
        },
      },
    ];
  }

  async function executeToolCall(ctx, name, args) {
    const scope = getPrivateScope(ctx);
    if (!scope) {
      return {
        ok: false,
        error: "生活助手功能只在与机器人的私聊中可用，以保护个人数据。",
      };
    }

    switch (name) {
      case "record_life_item":
        return createLifeRecord(scope, args);
      case "record_bill_entry":
        return recordBillEntry(scope, args);
      case "set_bill_cycle_day":
        return setBillCycleDay(scope, args);
      case "get_bill_summary":
        return getBillSummary(scope, args);
      case "get_bill_history":
        return getBillHistory(scope, args);
      case "create_todo":
        return createTodo(scope, args);
      case "list_today_todos":
        return listTodayTodos(scope);
      case "complete_todo":
        return completeTodo(scope, args);
      case "create_reminder":
        return createReminder(scope, args);
      case "create_calendar_event":
        return createCalendarEvent(scope, args);
      case "get_timeline":
        return getTimeline(scope, args);
      case "save_context_memory":
        return saveContextMemory(scope, args);
      case "search_context_memory":
        return searchContextMemory(scope, args);
      case "upsert_inventory_item":
        return upsertInventoryItem(scope, args);
      case "check_inventory":
        return checkInventory(scope, args);
      case "search_life_records":
        return searchLifeRecords(scope, args);
      case "get_life_summary":
        return getLifeSummary(scope, args);
      case "set_proactive_mode":
        return setProactiveMode(scope, args);
      case "save_place":
        return savePlace(scope, args);
      default:
        return { ok: false, error: `未知生活助手工具：${name}` };
    }
  }

  function handlesTool(name) {
    return getToolDefinitions().some((tool) => tool.function.name === name);
  }

  function startScheduler(getGlobalSettings) {
    if (schedulerTimer) {
      return;
    }

    const tick = async () => {
      try {
        const settings = await getGlobalSettings();
        if (!settings.lifeAssistantEnabled) {
          return;
        }

        await dispatchDueReminders();
        await archiveClosedBillCycles();
        if (Date.now() - lastHabitCheckAt >= HABIT_CHECK_INTERVAL_MS) {
          lastHabitCheckAt = Date.now();
          await runHabitChecks();
        }
      } catch (error) {
        console.error("生活助手定时检查失败:", error);
      }
    };

    void tick();
    schedulerTimer = setInterval(() => void tick(), REMINDER_INTERVAL_MS);
    schedulerTimer.unref?.();
  }

  function stopScheduler() {
    if (schedulerTimer) {
      clearInterval(schedulerTimer);
      schedulerTimer = undefined;
    }
  }

  return {
    executeToolCall,
    getToolDefinitions,
    handleLocation,
    handlesTool,
    startScheduler,
    stopScheduler,
  };
}

module.exports = { createLifeAssistant };
