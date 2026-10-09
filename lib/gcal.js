// Google Calendar через сервісний акаунт (docs/10-google-calendar-mcp.md).
//
// Секрети Cloudflare:
//   GCAL_SERVICE_ACCOUNT — вміст JSON-ключа сервісного акаунта (цілком);
//   GCAL_CALENDAR_ID     — id календаря власника (зазвичай його адреса Gmail).
// Власник ділиться своїм календарем з адресою сервісного акаунта з правом
// «Вносити зміни до подій». Сервісний акаунт не може запрошувати учасників
// (attendees) — цього і не робимо.

export const TZ = "Europe/Kyiv";
const SCOPE = "https://www.googleapis.com/auth/calendar.events";
const TOKEN_KEY = "gcal:token"; // кеш access-токена в KV (~55 хв)
const API = "https://www.googleapis.com/calendar/v3";

const enc = new TextEncoder();
const b64url = (bytes) =>
  btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const b64urlJson = (obj) => b64url(enc.encode(JSON.stringify(obj)));

export function isConfigured(env) {
  return Boolean(env.GCAL_SERVICE_ACCOUNT && env.GCAL_CALENDAR_ID);
}

function pemToDer(pem) {
  const body = pem.replace(/-----[A-Z ]+-----/g, "").replace(/\s+/g, "");
  const bin = atob(body);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
}

// Підписаний JWT для обміну на access-токен (RS256, ключ сервісного акаунта).
export async function makeAssertion(sa, now = Math.floor(Date.now() / 1000)) {
  const header = b64urlJson({ alg: "RS256", typ: "JWT" });
  const claims = b64urlJson({
    iss: sa.client_email,
    scope: SCOPE,
    aud: sa.token_uri || "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  });
  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToDer(sa.private_key),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, enc.encode(`${header}.${claims}`));
  return `${header}.${claims}.${b64url(sig)}`;
}

async function getAccessToken(env, force = false) {
  if (!force) {
    const cached = await env.CONTENT.get(TOKEN_KEY, "json");
    if (cached && cached.exp > Date.now() / 1000 + 60) return cached.token;
  }
  let sa;
  try {
    sa = JSON.parse(env.GCAL_SERVICE_ACCOUNT);
  } catch {
    throw new Error("GCAL_SERVICE_ACCOUNT: не вдалося прочитати JSON-ключ сервісного акаунта");
  }
  if (!sa.client_email || !sa.private_key) throw new Error("GCAL_SERVICE_ACCOUNT: у ключі немає client_email або private_key");

  const assertion = await makeAssertion(sa);
  const res = await fetch(sa.token_uri || "https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) {
    throw new Error(`Google не видав токен: ${data.error_description || data.error || res.status}`);
  }
  const ttl = Math.max(60, Number(data.expires_in || 3600) - 60);
  await env.CONTENT.put(TOKEN_KEY, JSON.stringify({ token: data.access_token, exp: Date.now() / 1000 + ttl }), {
    expirationTtl: ttl,
  });
  return data.access_token;
}

// Виклик Calendar API. path — відносно /calendar/v3, напр. "/calendars/.../events".
export async function gcal(env, method, path, { query, body } = {}, _retry = true) {
  const token = await getAccessToken(env);
  const url = new URL(API + path);
  for (const [k, v] of Object.entries(query || {})) if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, v);
  const res = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401 && _retry) {
    await env.CONTENT.delete(TOKEN_KEY);
    return gcal(env, method, path, { query, body }, false);
  }
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data?.error?.message || `HTTP ${res.status}`;
    if (res.status === 404) throw new Error(`Google Calendar: не знайдено (${msg}). Перевірте GCAL_CALENDAR_ID або id події.`);
    if (res.status === 403) throw new Error(`Google Calendar: немає доступу (${msg}). Чи поділився власник календарем із сервісним акаунтом?`);
    throw new Error(`Google Calendar: ${msg}`);
  }
  return data;
}

export const calPath = (env, suffix = "") => `/calendars/${encodeURIComponent(env.GCAL_CALENDAR_ID)}/events${suffix}`;

// ---------- Час: усе в Europe/Kyiv ----------

const partsFmt = new Intl.DateTimeFormat("en-US", {
  timeZone: TZ, hourCycle: "h23",
  year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
});

// Зміщення Києва відносно UTC (у хвилинах) у вказаний момент.
export function tzOffsetMinutes(date) {
  const p = Object.fromEntries(partsFmt.formatToParts(date).map((x) => [x.type, x.value]));
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return Math.round((asUtc - date.getTime()) / 60000);
}

// Локальний київський час (без зсуву) → момент часу (Date).
export function fromKyiv(y, mo, d, h = 0, mi = 0, s = 0) {
  const guess = Date.UTC(y, mo - 1, d, h, mi, s);
  let off = tzOffsetMinutes(new Date(guess));
  let instant = guess - off * 60000;
  const off2 = tzOffsetMinutes(new Date(instant));
  if (off2 !== off) instant = guess - off2 * 60000;
  return new Date(instant);
}

// Розбирає дату/час від ШІ. Повертає {date:"YYYY-MM-DD"} для цілого дня
// або {dateTime: Date}. Час без зсуву трактується як київський.
export function parseWhen(input) {
  const s = String(input || "").trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return { date: s };
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?(Z|[+-]\d{2}:?\d{2})?$/);
  if (!m) throw new Error(`Незрозумілий час «${s}». Формат: 2026-10-12T14:00 (київський час) або 2026-10-12 (цілий день).`);
  const [, y, mo, d, h, mi, sec, off] = m;
  let date;
  if (off) {
    date = new Date(`${y}-${mo}-${d}T${h}:${mi}:${sec || "00"}${off === "Z" ? "Z" : off.replace(/^([+-]\d{2})(\d{2})$/, "$1:$2")}`);
  } else {
    date = fromKyiv(+y, +mo, +d, +h, +mi, +(sec || 0));
  }
  if (Number.isNaN(date.getTime())) throw new Error(`Некоректна дата «${s}»`);
  return { dateTime: date };
}

// Об'єкт start/end для Google API.
export function toGoogleTime(when) {
  return when.date ? { date: when.date } : { dateTime: when.dateTime.toISOString(), timeZone: TZ };
}

const dayFmt = new Intl.DateTimeFormat("uk-UA", { timeZone: TZ, weekday: "short", day: "2-digit", month: "2-digit", year: "numeric" });
const timeFmt = new Intl.DateTimeFormat("uk-UA", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const isoDayFmt = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" });

export const fmtDay = (date) => dayFmt.format(date);
export const fmtTime = (date) => timeFmt.format(date);
export const kyivDate = (date = new Date()) => isoDayFmt.format(date); // "YYYY-MM-DD" за Києвом

// Людський опис події з відповіді Google.
export function describeEvent(ev) {
  const title = ev.summary || "(без назви)";
  let when;
  if (ev.start?.date) {
    const endDate = ev.end?.date; // у Google кінець цілоденної події — наступний день
    const start = ev.start.date;
    const last = endDate ? addDays(endDate, -1) : start;
    when = last !== start ? `${start} – ${last} (цілий день)` : `${start} (цілий день)`;
  } else {
    const s = new Date(ev.start.dateTime);
    const e = new Date(ev.end.dateTime);
    const sameDay = kyivDate(s) === kyivDate(e);
    when = `${fmtDay(s)} ${fmtTime(s)}–${sameDay ? "" : fmtDay(e) + " "}${fmtTime(e)}`;
  }
  const extra = [ev.location && `місце: ${ev.location}`, ev.description && `опис: ${ev.description}`].filter(Boolean);
  return `${when} — ${title}${extra.length ? ` (${extra.join("; ")})` : ""} [id: ${ev.id}]`;
}

export function addDays(isoDate, n) {
  const [y, m, d] = isoDate.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return t.toISOString().slice(0, 10);
}
