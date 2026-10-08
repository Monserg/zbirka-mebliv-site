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

// Фото з галереї (без заглушок) — для перегляду на повний екран.
let shots = [];

function renderPhotos(data) {
  if (!data) return;
  shots = (data.gallery || []).filter((p) => p.image).map((p) => ({ image: p.image, caption: p.caption || "" }));
  let i = 0;
  document.getElementById("gallery").innerHTML = (data.gallery || []).map((p) => p.image
    ? `<figure class="shot"><button class="shot__btn" type="button" data-shot="${i++}" aria-label="Відкрити фото на повний екран"><img src="${esc(p.image)}" alt="${esc(p.caption || "Наша робота")}" loading="lazy"></button>${p.caption ? `<figcaption>${esc(p.caption)}</figcaption>` : ""}</figure>`
    : `<div class="ph">${esc(p.caption || "Фото роботи")}</div>`).join("");
}

// Повноекранний перегляд фото: тап по фото в галереї; стрілки, свайп, Esc, тап по тлу.
const lightbox = document.getElementById("lightbox");
const lbImg = document.getElementById("lightbox-img");
const lbCap = document.getElementById("lightbox-cap");
const lbCount = document.getElementById("lightbox-count");
const lbPrev = document.getElementById("lightbox-prev");
const lbNext = document.getElementById("lightbox-next");
let lbIndex = 0;
let lbOpener = null;

function showShot(i) {
  lbIndex = (i + shots.length) % shots.length;
  const s = shots[lbIndex];
  lbImg.src = s.image;
  lbImg.alt = s.caption || "Наша робота";
  lbCap.textContent = s.caption;
  lbCount.textContent = shots.length > 1 ? `${lbIndex + 1} / ${shots.length}` : "";
  lbPrev.hidden = lbNext.hidden = shots.length < 2;
}

function openLightbox(i, opener) {
  lbOpener = opener || null;
  showShot(i);
  lightbox.hidden = false;
  document.body.classList.add("no-scroll");
  document.getElementById("lightbox").querySelector(".lightbox__close").focus();
}

function closeLightbox() {
  lightbox.hidden = true;
  lbImg.removeAttribute("src");
  document.body.classList.remove("no-scroll");
  if (lbOpener) lbOpener.focus();
}

document.getElementById("gallery").addEventListener("click", (e) => {
  const btn = e.target.closest("[data-shot]");
  if (btn) openLightbox(Number(btn.dataset.shot), btn);
});
lightbox.addEventListener("click", (e) => {
  if (e.target.closest("[data-close]") && !e.target.closest(".lightbox__img")) closeLightbox();
});
lbPrev.addEventListener("click", () => showShot(lbIndex - 1));
lbNext.addEventListener("click", () => showShot(lbIndex + 1));

let touchX = null;
lightbox.addEventListener("touchstart", (e) => { touchX = e.changedTouches[0].clientX; }, { passive: true });
lightbox.addEventListener("touchend", (e) => {
  if (touchX === null || shots.length < 2) return;
  const dx = e.changedTouches[0].clientX - touchX;
  touchX = null;
  if (Math.abs(dx) > 40) showShot(dx < 0 ? lbIndex + 1 : lbIndex - 1);
}, { passive: true });

// Бокове меню на телефоні: бургер у шапці відкриває, хрестик / тло / посилання / Esc закривають.
const drawer = document.getElementById("drawer");
const burger = document.getElementById("burger");

function setDrawer(open) {
  drawer.classList.toggle("open", open);
  drawer.inert = !open;
  burger.setAttribute("aria-expanded", String(open));
  burger.setAttribute("aria-label", open ? "Закрити меню" : "Відкрити меню");
  document.body.classList.toggle("no-scroll", open);
  if (open) drawer.querySelector(".drawer__close").focus();
  else if (document.activeElement === document.body || drawer.contains(document.activeElement)) burger.focus();
}

burger.addEventListener("click", () => setDrawer(!drawer.classList.contains("open")));
drawer.addEventListener("click", (e) => {
  if (e.target.closest("[data-close]") || e.target.closest("a")) setDrawer(false);
});
window.matchMedia("(min-width: 800px)").addEventListener("change", (e) => { if (e.matches) setDrawer(false); });

document.addEventListener("keydown", (e) => {
  if (!lightbox.hidden) {
    if (e.key === "Escape") closeLightbox();
    else if (e.key === "ArrowLeft") showShot(lbIndex - 1);
    else if (e.key === "ArrowRight") showShot(lbIndex + 1);
  } else if (e.key === "Escape" && drawer.classList.contains("open")) {
    setDrawer(false);
  }
});

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
