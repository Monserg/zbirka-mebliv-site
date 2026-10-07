// Адмінка: вхід, прайс, фото, зміна пароля. Сервер — functions/api/admin/*.
const $ = (sel, root = document) => root.querySelector(sel);
const state = { prices: { groups: [] }, photos: { gallery: [] } };
const dirty = { prices: false, photos: false };

async function api(path, { method = "GET", body, form } = {}) {
  const opts = { method, headers: { "X-Admin": "1" }, credentials: "same-origin" };
  if (form) opts.body = form;
  else if (body !== undefined) {
    opts.headers["Content-Type"] = "application/json";
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(path, opts);
  let data = {};
  try { data = await res.json(); } catch {}
  if (res.status === 401 && path !== "/api/admin/login") showLogin();
  if (!res.ok) throw new Error(data.error || `Помилка ${res.status}`);
  return data;
}

let toastTimer;
function toast(text, isError = false) {
  const t = $("#toast");
  t.textContent = text;
  t.className = isError ? "toast err" : "toast";
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), isError ? 6000 : 3000);
}

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
    else if (k === "value") node.value = v;
    else node.setAttribute(k, v);
  }
  node.append(...children);
  return node;
}

function move(list, i, delta) {
  const j = i + delta;
  if (j < 0 || j >= list.length) return;
  [list[i], list[j]] = [list[j], list[i]];
}

function markDirty(kind) { dirty[kind] = true; }

// ---------- Вхід ----------

function showLogin() {
  $("#app-view").hidden = true;
  $("#login-view").hidden = false;
  $("#login-form [name=login]").focus();
}

async function showApp() {
  $("#login-view").hidden = true;
  $("#app-view").hidden = false;
  const res = await fetch("/api/content", { cache: "no-cache" });
  const data = await res.json();
  state.prices = data.prices || { groups: [] };
  state.photos = { gallery: [], ...(data.photos || {}) };
  dirty.prices = dirty.photos = false;
  renderPrices();
  renderPhotos();
}

$("#login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const f = e.target;
  const btn = $("button", f);
  $("#login-msg").textContent = "";
  btn.disabled = true;
  try {
    await api("/api/admin/login", { method: "POST", body: { login: f.login.value, password: f.password.value } });
    f.reset();
    await showApp();
  } catch (err) {
    $("#login-msg").textContent = err.message;
  } finally {
    btn.disabled = false;
  }
});

$("#logout").addEventListener("click", async () => {
  if ((dirty.prices || dirty.photos) && !confirm("Є незбережені зміни. Все одно вийти?")) return;
  try { await api("/api/admin/logout", { method: "POST" }); } catch {}
  dirty.prices = dirty.photos = false;
  showLogin();
});

// ---------- Вкладки ----------

document.querySelectorAll("[data-tab]").forEach((tab) => {
  tab.addEventListener("click", () => {
    document.querySelectorAll("[data-tab]").forEach((t) => t.setAttribute("aria-selected", String(t === tab)));
    document.querySelectorAll("[data-panel]").forEach((p) => (p.hidden = p.dataset.panel !== tab.dataset.tab));
  });
});

// ---------- Прайс ----------

function renderPrices() {
  const root = $("#groups");
  root.replaceChildren();
  const groups = state.prices.groups;
  groups.forEach((g, gi) => {
    const items = el("div");
    g.items.forEach((it, ii) => {
      items.append(el("div", { class: "row" },
        el("input", { class: "name", value: it.name, placeholder: "Послуга", "aria-label": "Послуга", oninput: (e) => { it.name = e.target.value; markDirty("prices"); } }),
        el("input", { class: "price", value: it.price, placeholder: "від 300 грн", "aria-label": "Ціна", oninput: (e) => { it.price = e.target.value; markDirty("prices"); } }),
        el("button", { class: "icon", title: "Вище", "aria-label": "Вище", onclick: () => { move(g.items, ii, -1); markDirty("prices"); renderPrices(); } }, "↑"),
        el("button", { class: "icon", title: "Нижче", "aria-label": "Нижче", onclick: () => { move(g.items, ii, 1); markDirty("prices"); renderPrices(); } }, "↓"),
        el("button", { class: "icon del", title: "Видалити", "aria-label": "Видалити послугу", onclick: () => { g.items.splice(ii, 1); markDirty("prices"); renderPrices(); } }, "✕"),
      ));
    });
    root.append(el("div", { class: "group" },
      el("div", { class: "group__head" },
        el("input", { value: g.title, placeholder: "Назва групи", "aria-label": "Назва групи", oninput: (e) => { g.title = e.target.value; markDirty("prices"); } }),
        el("button", { class: "icon", title: "Група вище", "aria-label": "Група вище", onclick: () => { move(groups, gi, -1); markDirty("prices"); renderPrices(); } }, "↑"),
        el("button", { class: "icon", title: "Група нижче", "aria-label": "Група нижче", onclick: () => { move(groups, gi, 1); markDirty("prices"); renderPrices(); } }, "↓"),
        el("button", { class: "icon del", title: "Видалити групу", "aria-label": "Видалити групу", onclick: () => {
          if (!confirm(`Видалити групу «${g.title}» разом з усіма послугами?`)) return;
          groups.splice(gi, 1); markDirty("prices"); renderPrices();
        } }, "✕"),
      ),
      items,
      el("button", { class: "add", onclick: () => { g.items.push({ name: "", price: "" }); markDirty("prices"); renderPrices(); } }, "+ Додати послугу"),
    ));
  });
}

$("#add-group").addEventListener("click", () => {
  state.prices.groups.push({ title: "", items: [{ name: "", price: "" }] });
  markDirty("prices");
  renderPrices();
});

// ---------- Фото ----------

async function shrink(file, max = 1600) {
  try {
    const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
    const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bmp.width * scale);
    canvas.height = Math.round(bmp.height * scale);
    canvas.getContext("2d").drawImage(bmp, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((r) => canvas.toBlob(r, "image/jpeg", 0.85));
    return blob ? new File([blob], "photo.jpg", { type: "image/jpeg" }) : file;
  } catch {
    return file;
  }
}

function pickAndUpload(onDone) {
  const input = el("input", { type: "file", accept: "image/*" });
  input.addEventListener("change", async () => {
    const file = input.files[0];
    if (!file) return;
    toast("Завантажуємо фото…");
    try {
      const form = new FormData();
      form.append("file", await shrink(file));
      const { url } = await api("/api/admin/upload", { method: "POST", form });
      onDone(url);
      markDirty("photos");
      renderPhotos();
      toast("Фото завантажено. Не забудьте натиснути «Зберегти фото».");
    } catch (err) {
      toast(err.message, true);
    }
  });
  input.click();
}

function preview(src, emptyText) {
  return el("div", { class: "preview" }, src ? el("img", { src, alt: "" }) : emptyText);
}

function renderPhotos() {
  const root = $("#gallery");
  root.replaceChildren();
  const list = state.photos.gallery;
  list.forEach((p, i) => {
    root.append(el("div", { class: "shot" },
      preview(p.image, "Заглушка"),
      el("input", { value: p.caption || "", placeholder: "Підпис (необов'язково)", "aria-label": "Підпис", oninput: (e) => { p.caption = e.target.value; markDirty("photos"); } }),
      el("div", { class: "actions" },
        el("button", { class: "btn", onclick: () => pickAndUpload((url) => (p.image = url)) }, p.image ? "Замінити" : "Завантажити"),
        p.image ? el("button", { class: "btn", onclick: () => { p.image = ""; markDirty("photos"); renderPhotos(); } }, "Прибрати") : "",
        el("button", { class: "icon", title: "Раніше", "aria-label": "Раніше", onclick: () => { move(list, i, -1); markDirty("photos"); renderPhotos(); } }, "←"),
        el("button", { class: "icon", title: "Пізніше", "aria-label": "Пізніше", onclick: () => { move(list, i, 1); markDirty("photos"); renderPhotos(); } }, "→"),
        el("button", { class: "icon del", title: "Видалити місце", "aria-label": "Видалити місце для фото", onclick: () => { list.splice(i, 1); markDirty("photos"); renderPhotos(); } }, "✕"),
      ),
    ));
  });
}

$("#add-photo").addEventListener("click", () => {
  state.photos.gallery.push({ image: "", caption: "" });
  markDirty("photos");
  renderPhotos();
});

// ---------- Збереження ----------

document.querySelectorAll("[data-save]").forEach((btn) => {
  btn.addEventListener("click", async () => {
    const kind = btn.dataset.save;
    btn.disabled = true;
    try {
      await api(`/api/admin/${kind}`, { method: "PUT", body: state[kind] });
      dirty[kind] = false;
      toast(kind === "prices" ? "Прайс збережено, він уже на сайті" : "Фото збережено, вони вже на сайті");
    } catch (err) {
      toast(err.message, true);
    } finally {
      btn.disabled = false;
    }
  });
});

window.addEventListener("beforeunload", (e) => {
  if (dirty.prices || dirty.photos) e.preventDefault();
});

// ---------- Пароль ----------

$("#password-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const f = e.target;
  const msg = $("#password-msg");
  msg.className = "msg";
  msg.textContent = "";
  if (f.next.value !== f.repeat.value) {
    msg.textContent = "Нові паролі не збігаються";
    return;
  }
  try {
    await api("/api/admin/password", { method: "POST", body: { current: f.current.value, next: f.next.value } });
    f.reset();
    msg.className = "msg ok";
    msg.textContent = "Пароль змінено";
  } catch (err) {
    msg.textContent = err.message;
  }
});

// ---------- Старт ----------

api("/api/admin/me").then(showApp).catch(showLogin);
