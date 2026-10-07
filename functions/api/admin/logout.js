// POST /api/admin/logout
import { json, destroySession } from "../../../lib/util.js";

export async function onRequestPost({ env, data }) {
  return json({ ok: true }, 200, { "Set-Cookie": await destroySession(env, data.session.token) });
}
