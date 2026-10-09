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

// Плавне збільшення: «привид» фото летить від мініатюри до великого фото (і назад при закритті),
// тло тим часом затемнюється. Якщо в системі ввімкнено «зменшити рух» — без анімації.
const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
const LB_MS = 320;
let lbBusy = false;

function thumbFor(i) { return document.querySelector(`#gallery [data-shot="${i}"] img`); }

function flyGhost(src, from, to, radiusFrom, radiusTo) {
  const g = document.createElement("img");
  g.src = src; g.alt = ""; g.className = "lightbox__ghost";
  document.body.appendChild(g);
  const rect = (r, radius) => ({ top: `${r.top}px`, left: `${r.left}px`, width: `${r.width}px`, height: `${r.height}px`, borderRadius: radius });
  const anim = g.animate([rect(from, radiusFrom), rect(to, radiusTo)], { duration: LB_MS, easing: "cubic-bezier(.2,.8,.2,1)", fill: "forwards" });
  return anim.finished.catch(() => {}).then(() => g.remove());
}

// Чекаємо, поки велике фото завантажиться (зазвичай воно вже в кеші від мініатюри), але не довше 500 мс.
function imgReady(img) {
  if (img.complete && img.naturalWidth) return Promise.resolve();
  return Promise.race([
    new Promise((r) => { img.addEventListener("load", r, { once: true }); img.addEventListener("error", r, { once: true }); }),
    new Promise((r) => setTimeout(r, 500)),
  ]);
}

async function openLightbox(i, opener) {
  if (lbBusy || !lightbox.hidden) return;
  lbOpener = opener || null;
  showShot(i);
  lightbox.hidden = false;
  document.body.classList.add("no-scroll");
  lightbox.querySelector(".lightbox__close").focus();
  const thumb = opener && opener.querySelector("img");
  if (!thumb || reduceMotion.matches) return;
  lbBusy = true;
  lightbox.classList.add("is-anim");
  const fade = lightbox.animate([{ opacity: 0 }, { opacity: 1 }], { duration: LB_MS, easing: "ease-out" });
  await imgReady(lbImg);
  const to = lbImg.getBoundingClientRect();
  if (to.width && !lightbox.hidden) await flyGhost(lbImg.src, thumb.getBoundingClientRect(), to, getComputedStyle(thumb).borderRadius, "8px");
  await fade.finished.catch(() => {});
  lightbox.classList.remove("is-anim");
  lbBusy = false;
}

async function closeLightbox() {
  if (lbBusy || lightbox.hidden) return;
  const thumb = thumbFor(lbIndex);
  const focusTo = (thumb && thumb.closest("button")) || lbOpener;
  const from = lbImg.getBoundingClientRect();
  const to = thumb && thumb.getBoundingClientRect();
  // Летимо назад лише якщо мініатюра зараз на екрані; інакше просто гаснемо.
  const toVisible = to && to.width && to.bottom > 0 && to.top < window.innerHeight;
  if (!reduceMotion.matches && from.width) {
    lbBusy = true;
    lightbox.classList.add("is-anim");
    const fade = lightbox.animate([{ opacity: 1 }, { opacity: 0 }], { duration: toVisible ? LB_MS : 180, easing: "ease-in", fill: "forwards" });
    if (toVisible) await flyGhost(lbImg.src, from, to, "8px", getComputedStyle(thumb).borderRadius);
    await fade.finished.catch(() => {});
    fade.cancel();
    lightbox.classList.remove("is-anim");
    lbBusy = false;
  }
  lightbox.hidden = true;
  lbImg.removeAttribute("src");
  document.body.classList.remove("no-scroll");
  if (focusTo) focusTo.focus();
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

// Обов'язкові поля: ім'я, телефон (≥ 9 цифр), опис. Помилка зникає, щойно поле почали заповнювати.
const REQUIRED = ["name", "phone", "task"];
const isFilled = (field) =>
  field === "phone" ? form.phone.value.replace(/\D/g, "").length >= 9 : form[field].value.trim() !== "";
const setError = (field, on) => {
  form[field].classList.toggle("bad", on);
  form[field].setAttribute("aria-invalid", on ? "true" : "false");
  form.querySelector(`.err[data-for="${field}"]`).classList.toggle("show", on);
};
REQUIRED.forEach((field) => form[field].addEventListener("input", () => setError(field, false)));

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  statusEl.className = "status";
  statusEl.textContent = "";

  // Підсвічуємо всі незаповнені поля одразу, курсор — у перше з них.
  const missing = REQUIRED.filter((field) => !isFilled(field));
  REQUIRED.forEach((field) => setError(field, missing.includes(field)));
  if (missing.length) {
    form[missing[0]].focus();
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
