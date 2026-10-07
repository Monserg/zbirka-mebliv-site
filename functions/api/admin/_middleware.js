// Захист усіх /api/admin/*: потрібна сесія (крім входу) і заголовок X-Admin
// для запитів, що змінюють дані (додатковий захист від CSRF).
import { json, getSession } from "../../../lib/util.js";

export async function onRequest({ request, env, next, data }) {
  if (!env.CONTENT) return json({ error: "Сховище не підключено (KV CONTENT)" }, 500);
  if (request.method !== "GET" && request.headers.get("X-Admin") !== "1") {
    return json({ error: "Bad request" }, 400);
  }
  if (new URL(request.url).pathname === "/api/admin/login") return next();

  const session = await getSession(request, env);
  if (!session) return json({ error: "Потрібно увійти" }, 401);
  data.session = session;
  return next();
}
