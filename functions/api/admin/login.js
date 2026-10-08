// POST /api/admin/login {login, password}
import { json, checkCredentials, createSession } from "../../../lib/util.js";

const MAX_FAILS = 5;
const BLOCK_SECONDS = 15 * 60;

export async function onRequestPost({ request, env }) {
  const ip = request.headers.get("CF-Connecting-IP") || "local";
  const failKey = `fail:${ip}`;
  const fails = Number(await env.CONTENT.get(failKey)) || 0;
  if (fails >= MAX_FAILS) return json({ error: "Забагато невдалих спроб. Спробуйте через 15 хвилин." }, 429);

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Некоректний запит" }, 400);
  }
  const login = String(body.login || "").trim();
  const password = String(body.password || "");

  if (!login || !password || !(await checkCredentials(env, login, password))) {
    await env.CONTENT.put(failKey, String(fails + 1), { expirationTtl: BLOCK_SECONDS });
    return json({ error: "Невірний логін або пароль" }, 401);
  }

  await env.CONTENT.delete(failKey);
  return json({ ok: true, login }, 200, { "Set-Cookie": await createSession(env, login) });
}
