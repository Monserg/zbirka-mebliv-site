// POST /api/admin/reset — скидання пароля адмінки через код у Telegram власника.
//   {action: "send"}                 → код на 6 цифр у Telegram (TG_BOT_TOKEN, TG_CHAT_ID), діє 10 хвилин
//   {action: "confirm", code, next}  → перевірка коду, новий пароль, усі сесії завершуються
// Захист: новий код не частіше ніж раз на 5 хвилин; не більше 5 спроб ввести код;
// у сховищі лежить лише хеш коду. Працює без сесії (див. _middleware.js).
import { json, safeEqual, currentLogin, savePassword, destroyOtherSessions } from "../../../lib/util.js";

const CODE_TTL = 10 * 60; // секунд
const RESEND_TTL = 5 * 60;
const MAX_ATTEMPTS = 5;
const CODE_KEY = "reset:code";
const SENT_KEY = "reset:sent";

async function sha256(text) {
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function send(env) {
  if (!env.TG_BOT_TOKEN || !env.TG_CHAT_ID) {
    return json({ error: "Відновлення через Telegram не налаштовано. Скиньте пароль через панель Cloudflare (див. інструкцію до адмінки)." }, 503);
  }
  if (await env.CONTENT.get(SENT_KEY)) {
    return json({ error: "Код уже надіслано в Telegram. Новий можна запросити через 5 хвилин." }, 429);
  }
  const code = String(crypto.getRandomValues(new Uint32Array(1))[0] % 1000000).padStart(6, "0");
  const text = [
    `🔑 Код для скидання пароля адмінки: ${code}`,
    "Діє 10 хвилин. Введіть його на сторінці входу разом із новим паролем.",
    "Якщо це не ви, просто проігноруйте: без коду пароль змінити неможливо.",
  ].join("\n");
  const res = await fetch(`https://api.telegram.org/bot${env.TG_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: env.TG_CHAT_ID, text }),
  });
  if (!res.ok) return json({ error: "Не вдалося надіслати код у Telegram. Спробуйте пізніше." }, 502);

  const now = Date.now();
  await env.CONTENT.put(CODE_KEY, JSON.stringify({ hash: await sha256(code), created: now, attempts: 0 }), { expirationTtl: CODE_TTL });
  await env.CONTENT.put(SENT_KEY, String(now), { expirationTtl: RESEND_TTL });
  return json({ ok: true });
}

async function confirm(env, request, body) {
  const code = String(body.code || "").replace(/\D/g, "");
  const next = String(body.next || "");
  const saved = await env.CONTENT.get(CODE_KEY, "json");
  if (!saved) return json({ error: "Код не запитували або він прострочений. Надішліть новий." }, 400);

  const ttlLeft = Math.max(60, Math.round(CODE_TTL - (Date.now() - saved.created) / 1000));
  if (!/^\d{6}$/.test(code) || !safeEqual(await sha256(code), saved.hash)) {
    const attempts = (saved.attempts || 0) + 1;
    if (attempts >= MAX_ATTEMPTS) {
      await env.CONTENT.delete(CODE_KEY);
      return json({ error: "Забагато невдалих спроб. Код скасовано, надішліть новий." }, 429);
    }
    await env.CONTENT.put(CODE_KEY, JSON.stringify({ ...saved, attempts }), { expirationTtl: ttlLeft });
    return json({ error: `Невірний код. Залишилось спроб: ${MAX_ATTEMPTS - attempts}` }, 400);
  }
  if (next.length < 10) return json({ error: "Новий пароль має бути не коротший за 10 символів" }, 400);
  if (next.length > 200) return json({ error: "Пароль задовгий" }, 400);

  const login = await currentLogin(env);
  if (!login) return json({ error: "Початковий логін не заданий (секрет ADMIN_LOGIN)" }, 500);

  await savePassword(env, login, next);
  await destroyOtherSessions(env, null); // усі пристрої виходять з адмінки
  await env.CONTENT.delete(CODE_KEY);
  await env.CONTENT.delete(`fail:${request.headers.get("CF-Connecting-IP") || "local"}`); // знімаємо блокування входу
  return json({ ok: true, login });
}

export async function onRequestPost({ request, env }) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Некоректний запит" }, 400);
  }
  if (body.action === "send") return send(env);
  if (body.action === "confirm") return confirm(env, request, body);
  return json({ error: "Некоректний запит" }, 400);
}
