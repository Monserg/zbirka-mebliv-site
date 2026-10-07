// GET /api/content — прайс і фото для публічної сторінки.
import { json, readContent } from "../../lib/util.js";

export async function onRequestGet({ request, env }) {
  const [prices, photos] = await Promise.all([readContent(env, request, "prices"), readContent(env, request, "photos")]);
  return json({ prices, photos }, 200, { "Cache-Control": "no-cache" });
}
