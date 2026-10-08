// PUT /api/admin/photos {gallery: [{image, caption}]}
import { json } from "../../../lib/util.js";

const isPhoto = (v) => v === "" || (typeof v === "string" && /^\/(photos|images)\/[\w.-]+$/.test(v));

// Завантажені через адмінку фото, на які галерея вже не посилається (замінені,
// прибрані або завантажені й не збережені), — сміття. Прибираємо їх зі сховища
// після кожного збереження. Файли молодші за годину не чіпаємо: їх могли щойно
// завантажити в іншій вкладці і ще не зберегти (ім'я файлу починається з часу).
const GRACE_MS = 60 * 60 * 1000;

async function deleteUnusedPhotos(env, gallery) {
  const used = new Set(gallery.map((p) => p.image).filter((v) => v.startsWith("/photos/")).map((v) => v.slice("/photos/".length)));
  const now = Date.now();
  let cursor;
  do {
    const page = await env.CONTENT.list({ prefix: "photo:", cursor });
    const stale = page.keys
      .map((k) => k.name.slice("photo:".length))
      .filter((name) => !used.has(name) && now - Number(name.split("-")[0] || 0) > GRACE_MS);
    await Promise.all(stale.map((name) => env.CONTENT.delete(`photo:${name}`)));
    cursor = page.list_complete ? null : page.cursor;
  } while (cursor);
}

export async function onRequestPut({ request, env, waitUntil }) {
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
  // Чистимо сховище у фоні, щоб не затримувати відповідь адмінці.
  waitUntil(deleteUnusedPhotos(env, clean).catch(() => {}));
  return json({ ok: true });
}
