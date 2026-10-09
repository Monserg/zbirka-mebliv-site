// POST /api/lead — заявка з форми сайту → повідомлення в Telegram.
// Секрети Cloudflare: TG_BOT_TOKEN, TG_CHAT_ID (docs/04-telegram-leads.md).
import { json } from "../../lib/util.js";

const MAX_PHOTO_BYTES = 5 * 1024 * 1024;

export async function onRequestPost({ request, env }) {
  if (!env.TG_BOT_TOKEN || !env.TG_CHAT_ID) return json({ error: "Telegram не налаштовано" }, 503);

  let data;
  try {
    data = await request.formData();
  } catch {
    return json({ error: "Некоректний запит" }, 400);
  }

  // Пастка для ботів: справжні люди це поле не бачать і не заповнюють.
  if (data.get("website")) return json({ ok: true });

  const clip = (v, n) => String(v || "").trim().slice(0, n);
  const name = clip(data.get("name"), 80);
  const phone = clip(data.get("phone"), 30);
  const task = clip(data.get("task"), 800);
  // Ті самі правила, що й у формі (site/main.js): перевірку в браузері обійти не можна.
  if (!name) return json({ error: "Вкажіть ім'я" }, 400);
  if (phone.replace(/\D/g, "").length < 9) return json({ error: "Вкажіть телефон" }, 400);
  if (!task) return json({ error: "Опишіть, що потрібно зробити" }, 400);

  const time = new Date().toLocaleString("uk-UA", { timeZone: "Europe/Kyiv" });
  const text = [
    "🛠 Нова заявка з сайту",
    `Ім'я: ${name}`,
    `Телефон: ${phone}`,
    `Що зробити: ${task}`,
    `Час: ${time}`,
  ].join("\n");

  const api = `https://api.telegram.org/bot${env.TG_BOT_TOKEN}`;
  const photo = data.get("photo");
  let res;
  if (photo && typeof photo === "object" && photo.size > 0 && photo.size <= MAX_PHOTO_BYTES) {
    const tg = new FormData();
    tg.append("chat_id", env.TG_CHAT_ID);
    tg.append("caption", text);
    tg.append("photo", photo, photo.name || "photo.jpg");
    res = await fetch(`${api}/sendPhoto`, { method: "POST", body: tg });
  } else {
    res = await fetch(`${api}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: env.TG_CHAT_ID, text }),
    });
  }
  return res.ok ? json({ ok: true }) : json({ error: "Не вдалося надіслати в Telegram" }, 502);
}
