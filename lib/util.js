// Спільні функції для Cloudflare Pages Functions (папка functions/).

export const SESSION_TTL = 7 * 24 * 3600; // 7 днів
export const PBKDF2_ITER = 100000; // максимум, який дозволяє Cloudflare Workers
const COOKIE = "adm";
const enc = new TextEncoder();

export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers },
  });
}

const toHex = (bytes) => [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
const fromHex = (hex) => new Uint8Array(hex.match(/../g).map((h) => parseInt(h, 16)));

export function randomToken(bytes = 32) {
  return toHex(crypto.getRandomValues(new Uint8Array(bytes)));
}

export function safeEqual(a, b) {
  a = String(a); b = String(b);
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}

export async function hashPassword(password, saltHex, iterations = PBKDF2_ITER) {
  const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: fromHex(saltHex), iterations }, key, 256);
  return toHex(new Uint8Array(bits));
}

// Пароль, змінений в адмінці, лежить у KV ("auth"). Поки його не змінювали,
// діють початкові ADMIN_LOGIN / ADMIN_PASSWORD із секретів Cloudflare.
export async function checkCredentials(env, login, password) {
  const auth = await env.CONTENT.get("auth", "json");
  if (auth) {
    if (!safeEqual(login, auth.login)) return false;
    return safeEqual(await hashPassword(password, auth.salt, auth.iter), auth.hash);
  }
  if (!env.ADMIN_LOGIN || !env.ADMIN_PASSWORD) return false;
  const loginOk = safeEqual(login, env.ADMIN_LOGIN);
  const passwordOk = safeEqual(password, env.ADMIN_PASSWORD);
  return loginOk && passwordOk;
}

export async function currentLogin(env) {
  const auth = await env.CONTENT.get("auth", "json");
  return auth ? auth.login : env.ADMIN_LOGIN;
}

export async function savePassword(env, login, password) {
  const salt = randomToken(16);
  const hash = await hashPassword(password, salt);
  await env.CONTENT.put("auth", JSON.stringify({ login, salt, hash, iter: PBKDF2_ITER }));
}

function readCookie(request, name) {
  const m = (request.headers.get("Cookie") || "").match(new RegExp(`(?:^|;\\s*)${name}=([a-f0-9]{64})`));
  return m ? m[1] : null;
}

export async function getSession(request, env) {
  const token = readCookie(request, COOKIE);
  if (!token) return null;
  const s = await env.CONTENT.get(`sess:${token}`, "json");
  return s ? { ...s, token } : null;
}

export async function createSession(env, login) {
  const token = randomToken(32);
  await env.CONTENT.put(`sess:${token}`, JSON.stringify({ login, created: Date.now() }), { expirationTtl: SESSION_TTL });
  return `${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${SESSION_TTL}`;
}

export async function destroySession(env, token) {
  if (token) await env.CONTENT.delete(`sess:${token}`);
  return `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;
}

export async function destroyOtherSessions(env, keepToken) {
  let cursor;
  do {
    const page = await env.CONTENT.list({ prefix: "sess:", cursor });
    await Promise.all(page.keys.filter((k) => k.name !== `sess:${keepToken}`).map((k) => env.CONTENT.delete(k.name)));
    cursor = page.list_complete ? null : page.cursor;
  } while (cursor);
}

// Читає збережений контент; якщо в KV ще нічого немає — бере початкові файли сайту.
export async function readContent(env, request, name) {
  const saved = await env.CONTENT.get(`content:${name}`, "json");
  if (saved) return saved;
  const res = await env.ASSETS.fetch(new URL(`/content/${name}.json`, request.url));
  return res.ok ? res.json() : null;
}
