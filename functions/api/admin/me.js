// GET /api/admin/me — хто увійшов (перевірка сесії при відкритті адмінки).
import { json } from "../../../lib/util.js";

export async function onRequestGet({ data }) {
  return json({ login: data.session.login });
}
