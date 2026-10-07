// PUT /api/admin/photos {gallery: [{image, caption}]}
import { json } from "../../../lib/util.js";

const isPhoto = (v) => v === "" || (typeof v === "string" && /^\/(photos|images)\/[\w.-]+$/.test(v));

export async function onRequestPut({ request, env }) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Bad request" }, 400);
  }
  const { gallery = [] } = body;
  if (!Array.isArray(gallery) || gallery.length > 40) return json({ error: "У галереї до 40 фото" }, 400);

  const clean = [];
  for (const p of gallery) {
    const caption = typeof p?.caption === "string" ? p.caption.trim().slice(0, 120) : "";
    if (!isPhoto(p?.image ?? "")) return json({ error: "Невірне посилання на фото в галереї" }, 400);
    clean.push({ image: p.image || "", caption });
  }

  await env.CONTENT.put("content:photos", JSON.stringify({ gallery: clean }));
  return json({ ok: true });
}
