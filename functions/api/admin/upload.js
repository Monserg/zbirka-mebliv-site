// POST /api/admin/upload (multipart, поле "file") → {url: "/photos/<файл>"}
// Фото зберігаються в KV (ключ "photo:<файл>"): безкоштовно і без платіжної картки.
import { json, randomToken } from "../../../lib/util.js";

const TYPES = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
const MAX_BYTES = 8 * 1024 * 1024;

export async function onRequestPost({ request, env }) {
  let file;
  try {
    file = (await request.formData()).get("file");
  } catch {
    return json({ error: "Bad request" }, 400);
  }
  if (!file || typeof file !== "object") return json({ error: "Файл не отримано" }, 400);
  const ext = TYPES[file.type];
  if (!ext) return json({ error: "Підтримуються лише JPG, PNG або WebP" }, 400);
  if (file.size > MAX_BYTES) return json({ error: "Файл завеликий (максимум 8 МБ)" }, 400);

  const key = `${Date.now()}-${randomToken(6)}.${ext}`;
  await env.CONTENT.put(`photo:${key}`, await file.arrayBuffer(), { metadata: { type: file.type } });
  return json({ url: `/photos/${key}` });
}
