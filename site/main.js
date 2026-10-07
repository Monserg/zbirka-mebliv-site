// Прайс і фото редагуються в адмінці (/admin) і віддаються через /api/content.
// Якщо API недоступне (локальний перегляд без Cloudflare) — беремо content/*.json.
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

async function loadJSON(path) {
  const res = await fetch(path, { cache: "no-cache" });
  if (!res.ok) throw new Error(path);
  return res.json();
}

async function loadContent() {
  if (window.__CONTENT__) return window.__CONTENT__; // демо-файл (scripts/build-demo.py)
  try {
    return await loadJSON("/api/content");
  } catch {
    const [prices, photos] = await Promise.all([loadJSON("content/prices.json"), loadJSON("content/photos.json")]);
    return { prices, photos };
  }
}

// Прайс показуємо повністю (без згортання): кожна група — картка в сітці.
function renderPrices(data) {
  document.getElementById("price").innerHTML = (data?.groups || []).map((g) => `
    <article class="price__group">
      <h3>${esc(g.title)}</h3>
      <ul>${(g.items || []).map((it) => `<li><span>${esc(it.name)}</span><b>${esc(it.price)}</b></li>`).join("")}</ul>
    </article>`).join("");
}

function renderPhotos(data) {
  if (!data) return;
  document.getElementById("gallery").innerHTML = (data.gallery || []).map((p) => p.image
    ? `<figure class="shot"><img src="${esc(p.image)}" alt="${esc(p.caption || "Наша робота")}" loading="lazy">${p.caption ? `<figcaption>${esc(p.caption)}</figcaption>` : ""}</figure>`
    : `<div class="ph">${esc(p.caption || "Фото роботи")}</div>`).join("");
}

loadContent().then(({ prices, photos }) => {
  renderPrices(prices);
  renderPhotos(photos);
}).catch(() => {
  document.getElementById("price").innerHTML = '<p class="sub">Ціни уточнюйте за телефоном 096 975 86 15.</p>';
});

// Заявка з форми → functions/api/lead.js → Telegram (docs/04-telegram-leads.md).
const LEAD_ENDPOINT = "/api/lead";

const form = document.getElementById("lead-form");
const statusEl = document.getElementById("form-status");
const phoneErr = form.querySelector('.err[data-for="phone"]');

form.phone.addEventListener("input", () => phoneErr.classList.remove("show"));

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  statusEl.className = "status";
  statusEl.textContent = "";

  const digits = form.phone.value.replace(/\D/g, "");
  if (digits.length < 9) {
    phoneErr.classList.add("show");
    form.phone.focus();
    return;
  }

  if (window.__DEMO__) {
    statusEl.className = "status ok";
    statusEl.textContent = "Демо-версія: заявку не надіслано. На робочому сайті вона одразу прийде в Telegram.";
    return;
  }

  if (!LEAD_ENDPOINT) {
    statusEl.className = "status fail";
    statusEl.textContent = "Форма ще не підключена. Подзвоніть: 096 975 86 15";
    return;
  }

  const btn = form.querySelector("button[type=submit]");
  btn.disabled = true;
  btn.textContent = "Надсилаємо…";
  try {
    const res = await fetch(LEAD_ENDPOINT, { method: "POST", body: new FormData(form) });
    if (!res.ok) throw new Error(res.status);
    form.reset();
    statusEl.className = "status ok";
    statusEl.textContent = "Дякуємо! Заявку отримано, передзвонимо найближчим часом.";
  } catch {
    statusEl.className = "status fail";
    statusEl.textContent = "Не вдалося надіслати. Подзвоніть, будь ласка: 096 975 86 15";
  } finally {
    btn.disabled = false;
    btn.textContent = "Надіслати заявку";
  }
});
