// Захист усіх /api/admin/*: потрібна сесія (крім входу) і заголовок X-Admin
// для запитів, що змінюють дані (додатковий захист від CSRF).
import { json, getSession } from "../../../lib/util.js";

export async function onRequest({ request, env, next, data }) {
  if (!env.CONTENT) return json({ error: "Сховище не підключено (KV CONTENT)" }, 500);
  if (request.method !== "GET" && request.headers.get("X-Admin") !== "1") {
    return json({ error: "Некоректний запит" }, 400);
  }
  // Вхід і скидання пароля працюють без сесії.
  const path = new URL(request.url).pathname;
  if (path === "/api/admin/login" || path === "/api/admin/reset") return next();

  const session = await getSession(request, env);
  if (!session) return json({ error: "Потрібно увійти" }, 401);
  data.session = session;
  return next();
}
