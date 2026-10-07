// POST /api/admin/password {current, next} — зміна пароля.
// Після зміни всі інші сесії (інші телефони/комп'ютери) виходять з адмінки.
import { json, checkCredentials, savePassword, destroyOtherSessions } from "../../../lib/util.js";

export async function onRequestPost({ request, env, data }) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Bad request" }, 400);
  }
  const current = String(body.current || "");
  const next = String(body.next || "");
  const login = data.session.login;

  if (!(await checkCredentials(env, login, current))) return json({ error: "Поточний пароль невірний" }, 400);
  if (next.length < 10) return json({ error: "Новий пароль має бути не коротший за 10 символів" }, 400);
  if (next.length > 200) return json({ error: "Пароль задовгий" }, 400);
  if (next === current) return json({ error: "Новий пароль збігається з поточним" }, 400);

  await savePassword(env, login, next);
  await destroyOtherSessions(env, data.session.token);
  return json({ ok: true });
}
