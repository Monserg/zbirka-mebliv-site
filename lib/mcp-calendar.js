// MCP-сервер «Календар майстра»: дає ШІ (Claude тощо) інструменти для
// Google-календаря власника. Транспорт — Streamable HTTP (JSON-RPC через POST),
// без стану і без SSE. Опис підключення — docs/10-google-calendar-mcp.md.
import { json, safeEqual } from "./util.js";
import {
  TZ, isConfigured, gcal, calPath, parseWhen, toGoogleTime, fromKyiv, kyivDate, addDays,
  describeEvent, fmtDay, fmtTime,
} from "./gcal.js";

const SERVER = { name: "zbirka-mebliv-calendar", version: "1.0.0" };
const PROTOCOLS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];
const MAX_EVENTS = 50;

const INSTRUCTIONS = [
  "Це календар майстра зі збірки та ремонту меблів (Хмельницький). Усі часи — київські (Europe/Kyiv).",
  "Час передавайте у форматі 2026-10-12T14:00 (без зсуву = київський) або 2026-10-12 для події на цілий день.",
  "Перш ніж створювати, змінювати чи видаляти подію, переконайтеся, що власник цього хоче, і перевірте зайнятість (free_slots або list_events).",
  "У назву події кладіть, що робити і для кого (наприклад «Збірка шафи — Олена, 096 ...»), адресу — в location, деталі й телефон — в description.",
].join(" ");

const str = (desc, extra = {}) => ({ type: "string", description: desc, ...extra });
const int = (desc, extra = {}) => ({ type: "integer", description: desc, ...extra });

export const TOOLS = [
  {
    name: "list_events",
    description: "Список подій календаря за період (за замовчуванням — найближчі 7 днів). Повертає час, назву, місце, опис і id кожної події.",
    inputSchema: {
      type: "object",
      properties: {
        from: str("Початок періоду: 2026-10-12 або 2026-10-12T09:00 (київський час). За замовчуванням — зараз."),
        to: str("Кінець періоду (той самий формат). За замовчуванням — from + 7 днів."),
        query: str("Пошук за текстом у назві, описі чи місці (необов'язково)."),
      },
      additionalProperties: false,
    },
  },
  {
    name: "free_slots",
    description: "Вільні проміжки в робочі години, куди вміщується робота заданої тривалості. Зайнятість береться з подій календаря (цілоденні події блокують день).",
    inputSchema: {
      type: "object",
      properties: {
        date: str("Перший день, YYYY-MM-DD (за замовчуванням — сьогодні)."),
        days: int("Скільки днів перевірити, 1–14 (за замовчуванням 1).", { minimum: 1, maximum: 14 }),
        duration_minutes: int("Тривалість роботи у хвилинах (за замовчуванням 120).", { minimum: 15, maximum: 720 }),
        work_start: str("Початок робочого дня, HH:MM (за замовчуванням 09:00)."),
        work_end: str("Кінець робочого дня, HH:MM (за замовчуванням 18:00)."),
      },
      additionalProperties: false,
    },
  },
  {
    name: "create_event",
    description: "Створити подію (запис клієнта) у календарі власника. Повертає опис створеної події та її id.",
    inputSchema: {
      type: "object",
      properties: {
        title: str("Назва: що зробити і для кого, напр. «Збірка шафи — Олена»."),
        start: str("Початок: 2026-10-12T14:00 (київський час) або 2026-10-12 (цілий день)."),
        end: str("Кінець у тому ж форматі. Якщо не вказано — start + duration_minutes."),
        duration_minutes: int("Тривалість, якщо end не вказано (за замовчуванням 120).", { minimum: 15, maximum: 1440 }),
        location: str("Адреса клієнта (необов'язково)."),
        description: str("Деталі: телефон клієнта, що саме зробити, домовленості (необов'язково)."),
      },
      required: ["title", "start"],
      additionalProperties: false,
    },
  },
  {
    name: "update_event",
    description: "Змінити подію за id: назву, час, місце чи опис. Передавайте лише ті поля, які треба змінити.",
    inputSchema: {
      type: "object",
      properties: {
        event_id: str("id події з list_events або create_event."),
        title: str("Нова назва."),
        start: str("Новий початок (2026-10-12T14:00 або 2026-10-12)."),
        end: str("Новий кінець. Якщо змінюєте start без end — тривалість зберігається."),
        location: str("Нова адреса."),
        description: str("Новий опис."),
      },
      required: ["event_id"],
      additionalProperties: false,
    },
  },
  {
    name: "delete_event",
    description: "Видалити подію за id. Незворотно — спершу підтвердьте у власника.",
    inputSchema: {
      type: "object",
      properties: { event_id: str("id події.") },
      required: ["event_id"],
      additionalProperties: false,
    },
  },
];

// ---------- Інструменти ----------

const clip = (v, n) => (v === undefined || v === null ? undefined : String(v).trim().slice(0, n));

function parseHHMM(s, fallback) {
  const m = String(s || fallback).match(/^(\d{1,2}):(\d{2})$/);
  if (!m || +m[1] > 23 || +m[2] > 59) throw new Error(`Невірний час «${s}», очікується HH:MM`);
  return [+m[1], +m[2]];
}

async function listEvents(env, a) {
  const from = a.from ? parseWhen(a.from) : { dateTime: new Date() };
  const fromDate = from.date ? fromKyiv(...from.date.split("-").map(Number)) : from.dateTime;
  let toDate;
  if (a.to) {
    const to = parseWhen(a.to);
    toDate = to.date ? fromKyiv(...addDays(to.date, 1).split("-").map(Number)) : to.dateTime; // ціла дата = включно
  } else {
    toDate = new Date(fromDate.getTime() + 7 * 86400000);
  }
  if (toDate <= fromDate) throw new Error("«to» має бути пізніше за «from»");
  const data = await gcal(env, "GET", calPath(env), {
    query: {
      timeMin: fromDate.toISOString(), timeMax: toDate.toISOString(),
      singleEvents: "true", orderBy: "startTime", maxResults: String(MAX_EVENTS), timeZone: TZ,
      q: clip(a.query, 100),
    },
  });
  const items = (data.items || []).filter((e) => e.status !== "cancelled");
  const head = `Події з ${fmtDay(fromDate)} ${fmtTime(fromDate)} до ${fmtDay(toDate)} ${fmtTime(toDate)}:`;
  if (!items.length) return `${head}\n(подій немає)`;
  const lines = items.map((e) => `• ${describeEvent(e)}`);
  if (data.nextPageToken) lines.push(`… показано перші ${MAX_EVENTS}, звузьте період.`);
  return `${head}\n${lines.join("\n")}`;
}

async function freeSlots(env, a) {
  const first = a.date ? parseWhen(a.date) : { date: kyivDate() };
  if (!first.date) throw new Error("«date» має бути датою YYYY-MM-DD");
  const days = Math.min(14, Math.max(1, Number(a.days) || 1));
  const dur = Math.max(15, Number(a.duration_minutes) || 120) * 60000;
  const [wsH, wsM] = parseHHMM(a.work_start, "09:00");
  const [weH, weM] = parseHHMM(a.work_end, "18:00");
  const lastDay = addDays(first.date, days - 1);
  const rangeStart = fromKyiv(...first.date.split("-").map(Number));
  const rangeEnd = fromKyiv(...addDays(lastDay, 1).split("-").map(Number));

  const data = await gcal(env, "GET", calPath(env), {
    query: { timeMin: rangeStart.toISOString(), timeMax: rangeEnd.toISOString(), singleEvents: "true", orderBy: "startTime", maxResults: "250", timeZone: TZ },
  });
  const busy = (data.items || [])
    .filter((e) => e.status !== "cancelled" && e.transparency !== "transparent")
    .map((e) => {
      if (e.start?.date) return [fromKyiv(...e.start.date.split("-").map(Number)), fromKyiv(...e.end.date.split("-").map(Number))];
      return [new Date(e.start.dateTime), new Date(e.end.dateTime)];
    });

  const now = Date.now();
  const out = [`Вільні проміжки від ${Math.round(dur / 60000)} хв (робочі години ${pad(wsH)}:${pad(wsM)}–${pad(weH)}:${pad(weM)}, Київ):`];
  for (let i = 0; i < days; i++) {
    const day = addDays(first.date, i);
    const [y, m, d] = day.split("-").map(Number);
    const dayStart = fromKyiv(y, m, d, wsH, wsM);
    const dayEnd = fromKyiv(y, m, d, weH, weM);
    if (dayEnd <= dayStart) throw new Error("work_end має бути пізніше за work_start");
    const blocks = busy
      .filter(([s, e]) => e > dayStart && s < dayEnd)
      .map(([s, e]) => [Math.max(s.getTime(), dayStart.getTime()), Math.min(e.getTime(), dayEnd.getTime())])
      .sort((p, q) => p[0] - q[0]);
    const slots = [];
    let cursor = Math.max(dayStart.getTime(), now);
    for (const [s, e] of blocks) {
      if (s - cursor >= dur) slots.push([cursor, s]);
      cursor = Math.max(cursor, e);
    }
    if (dayEnd.getTime() - cursor >= dur) slots.push([cursor, dayEnd.getTime()]);
    const label = fmtDay(dayStart);
    if (!slots.length) out.push(`• ${label}: вільного часу немає`);
    else out.push(`• ${label}: ${slots.map(([s, e]) => `${fmtTime(new Date(s))}–${fmtTime(new Date(e))}`).join(", ")}`);
  }
  return out.join("\n");
}

const pad = (n) => String(n).padStart(2, "0");

function buildTimes(startRaw, endRaw, durationMinutes) {
  const start = parseWhen(startRaw);
  let end;
  if (endRaw) {
    end = parseWhen(endRaw);
    if (Boolean(start.date) !== Boolean(end.date)) throw new Error("start і end мають бути одного типу: обидва з часом або обидва цілоденні");
  } else if (start.date) {
    end = { date: start.date }; // один день; нижче перетвориться на «наступний день» для Google
  } else {
    const dur = Math.max(15, Number(durationMinutes) || 120);
    end = { dateTime: new Date(start.dateTime.getTime() + dur * 60000) };
  }
  if (start.date) {
    if (end.date <= start.date) end = { date: addDays(start.date, 1) }; // для Google кінець цілоденної події — наступний день
    else end = { date: addDays(end.date, 1) };
  } else if (end.dateTime <= start.dateTime) {
    throw new Error("Кінець події має бути пізніше за початок");
  }
  return { start: toGoogleTime(start), end: toGoogleTime(end) };
}

async function createEvent(env, a) {
  const title = clip(a.title, 200);
  if (!title) throw new Error("Вкажіть назву події (title)");
  if (!a.start) throw new Error("Вкажіть початок (start)");
  const body = {
    summary: title,
    ...buildTimes(a.start, a.end, a.duration_minutes),
    location: clip(a.location, 300),
    description: clip(a.description, 2000),
  };
  const ev = await gcal(env, "POST", calPath(env), { body });
  return `Створено: ${describeEvent(ev)}`;
}

async function updateEvent(env, a) {
  const id = clip(a.event_id, 200);
  if (!id) throw new Error("Вкажіть event_id");
  const patch = {};
  if (a.title !== undefined) {
    patch.summary = clip(a.title, 200);
    if (!patch.summary) throw new Error("Назва не може бути порожньою");
  }
  if (a.location !== undefined) patch.location = clip(a.location, 300);
  if (a.description !== undefined) patch.description = clip(a.description, 2000);
  if (a.start || a.end) {
    const current = await gcal(env, "GET", calPath(env, `/${encodeURIComponent(id)}`));
    const curStart = current.start.date ? parseWhen(current.start.date) : { dateTime: new Date(current.start.dateTime) };
    const curEnd = current.end.date ? parseWhen(addDays(current.end.date, -1)) : { dateTime: new Date(current.end.dateTime) };
    let startRaw = a.start;
    let endRaw = a.end;
    let duration;
    if (!startRaw) startRaw = curStart.date || curStart.dateTime.toISOString();
    if (!endRaw) {
      if (a.start && !curStart.date && !curEnd.date) duration = (curEnd.dateTime - curStart.dateTime) / 60000; // зсув зі збереженням тривалості
      else if (!a.start) endRaw = curEnd.date || curEnd.dateTime.toISOString();
    }
    Object.assign(patch, buildTimes(startRaw, endRaw, duration));
  }
  if (!Object.keys(patch).length) throw new Error("Нічого змінювати: передайте хоча б одне поле");
  const ev = await gcal(env, "PATCH", calPath(env, `/${encodeURIComponent(id)}`), { body: patch });
  return `Оновлено: ${describeEvent(ev)}`;
}

async function deleteEvent(env, a) {
  const id = clip(a.event_id, 200);
  if (!id) throw new Error("Вкажіть event_id");
  await gcal(env, "DELETE", calPath(env, `/${encodeURIComponent(id)}`));
  return `Подію ${id} видалено.`;
}

const HANDLERS = { list_events: listEvents, free_slots: freeSlots, create_event: createEvent, update_event: updateEvent, delete_event: deleteEvent };

async function callTool(env, name, args) {
  const fn = HANDLERS[name];
  if (!fn) return { content: [{ type: "text", text: `Невідомий інструмент: ${name}` }], isError: true };
  if (!isConfigured(env)) {
    return { content: [{ type: "text", text: "Google Calendar не налаштовано: немає секретів GCAL_SERVICE_ACCOUNT / GCAL_CALENDAR_ID (docs/10-google-calendar-mcp.md)." }], isError: true };
  }
  try {
    const text = await fn(env, args && typeof args === "object" ? args : {});
    return { content: [{ type: "text", text }] };
  } catch (e) {
    return { content: [{ type: "text", text: `Помилка: ${e.message}` }], isError: true };
  }
}

// ---------- JSON-RPC ----------

const rpcError = (id, code, message) => ({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });
const rpcResult = (id, result) => ({ jsonrpc: "2.0", id, result });

async function handleMessage(env, msg) {
  if (!msg || typeof msg !== "object" || msg.jsonrpc !== "2.0" || typeof msg.method !== "string") {
    return rpcError(msg?.id, -32600, "Invalid Request");
  }
  const { id, method, params = {} } = msg;
  const isNotification = id === undefined || id === null;
  if (method.startsWith("notifications/")) return null;

  switch (method) {
    case "initialize": {
      const asked = params.protocolVersion;
      return rpcResult(id, {
        protocolVersion: PROTOCOLS.includes(asked) ? asked : PROTOCOLS[1],
        capabilities: { tools: {} },
        serverInfo: SERVER,
        instructions: INSTRUCTIONS,
      });
    }
    case "ping":
      return rpcResult(id, {});
    case "tools/list":
      return rpcResult(id, { tools: TOOLS });
    case "tools/call": {
      if (typeof params.name !== "string") return rpcError(id, -32602, "Missing tool name");
      return rpcResult(id, await callTool(env, params.name, params.arguments));
    }
    default:
      return isNotification ? null : rpcError(id, -32601, `Method not found: ${method}`);
  }
}

// Токен: заголовок Authorization: Bearer <MCP_TOKEN> або останній сегмент шляху /mcp/<MCP_TOKEN>.
function authorized(request, env, pathToken) {
  if (!env.MCP_TOKEN || env.MCP_TOKEN.length < 16) return false;
  const h = request.headers.get("Authorization") || "";
  const bearer = h.match(/^Bearer\s+(\S+)$/i)?.[1];
  if (bearer && safeEqual(bearer, env.MCP_TOKEN)) return true;
  return Boolean(pathToken) && safeEqual(pathToken, env.MCP_TOKEN);
}

export async function handleMcp({ request, env, params }) {
  const segments = [].concat(params?.path || []).filter(Boolean);
  if (segments.length > 1) return new Response("Not found", { status: 404 });
  if (!env.MCP_TOKEN || env.MCP_TOKEN.length < 16) return json({ error: "MCP не налаштовано: задайте секрет MCP_TOKEN (16+ символів)" }, 503);
  if (!authorized(request, env, segments[0])) {
    return json({ error: "Unauthorized" }, 401, { "WWW-Authenticate": 'Bearer realm="mcp"' });
  }

  if (request.method === "GET") return new Response("Method Not Allowed", { status: 405, headers: { Allow: "POST" } });
  if (request.method === "DELETE") return new Response(null, { status: 204 }); // сесій немає — нічого завершувати
  if (request.method !== "POST") return new Response("Method Not Allowed", { status: 405, headers: { Allow: "POST" } });

  let body;
  try {
    body = await request.json();
  } catch {
    return json(rpcError(null, -32700, "Parse error"), 400);
  }
  const batch = Array.isArray(body);
  const messages = batch ? body : [body];
  if (!messages.length) return json(rpcError(null, -32600, "Invalid Request"), 400);

  const responses = (await Promise.all(messages.map((m) => handleMessage(env, m)))).filter(Boolean);
  if (!responses.length) return new Response(null, { status: 202 });
  return json(batch ? responses : responses[0]);
}
