# Технічний опис

## Архітектура

- **Cloudflare Pages** віддає статичні файли з `site/`.
- **Pages Functions** (`functions/`) — серверна частина: API адмінки, видача
  контенту і фото, пересилання заявок у Telegram.
- **Cloudflare KV** (прив'язка `CONTENT`) — єдине сховище.
- Без фреймворків, без збирача: HTML/CSS/JS як є.

### Ключі в KV

| Ключ | Що | Коли з'являється |
|---|---|---|
| `content:prices` | `{groups:[{title, items:[{name, price}]}]}` | після першого збереження прайсу |
| `content:photos` | `{gallery:[{image, caption}]}` | після першого збереження фото |
| `photo:<файл>` | бінарний файл фото, metadata `{type}` | при завантаженні фото |
| `auth` | `{login, salt, hash, iter}` (PBKDF2-SHA256) | після першої зміни пароля |
| `sess:<токен>` | `{login, created, seen}`, TTL 7 днів; видаляється, якщо `seen` старіше 5 хв | при вході; `seen` оновлюється раз на хвилину |
| `fail:<IP>` | лічильник невдалих входів, TTL 15 хв | при невдалому вході |

Поки `content:*` немає, `/api/content` віддає початкові файли
`site/content/prices.json` і `site/content/photos.json`.

## Файли

```
zbirka-mebliv-site/
├── site/                      ← публікується на Cloudflare Pages
│   ├── index.html             сторінка (тексти, контакти — тут; місця з TODO)
│   ├── styles.css             дизайн «Теплий майстер», структура «Ціни-перший»
│   ├── main.js                прайс/фото з /api/content, форма заявки, демо-режим
│   ├── content/prices.json    початковий прайс (зі старого сайту)
│   ├── content/photos.json    початкові фото (порожньо = заглушки)
│   ├── robots.txt             закриває /admin і /api від пошуковиків
│   └── admin/                 адмінка: index.html, admin.css, admin.js
├── functions/                 ← серверна частина (Pages Functions)
│   ├── api/content.js         GET  /api/content       прайс + фото для сайту
│   ├── api/lead.js            POST /api/lead          заявка → Telegram
│   ├── photos/[[path]].js     GET  /photos/<файл>     фото з KV
│   └── api/admin/
│       ├── _middleware.js     перевірка сесії і заголовка X-Admin
│       ├── login.js           POST /api/admin/login   {login, password}
│       ├── logout.js          POST /api/admin/logout
│       ├── me.js              GET  /api/admin/me
│       ├── prices.js          PUT  /api/admin/prices  {groups}
│       ├── photos.js          PUT  /api/admin/photos  {gallery}; видаляє з KV фото, яких у галереї вже немає
│       ├── upload.js          POST /api/admin/upload  multipart "file" → {url}
│       └── password.js        POST /api/admin/password {current, next}
├── lib/util.js                паролі (PBKDF2), сесії, читання контенту
├── scripts/build-demo.py      збирає демо-файл для клієнта → dist/
├── wrangler.toml              налаштування Cloudflare (id KV вписати!)
├── package.json               npm run dev / npm run deploy
├── .dev.vars                  тестовий логін/пароль для локального запуску (не публікується)
├── reference/old-wix-site/    тексти, прайс, зображення старого сайту
├── CLAUDE.md                  підказки для Claude
└── .gitignore
```

## Локальний запуск (з адмінкою)

Потрібен Node.js (перевірено на v24).

```bash
cd zbirka-mebliv-site
npm install
npm run dev
```

Відкрити http://localhost:8788 (сайт) і http://localhost:8788/admin (адмінка).
Логін/пароль для локальної перевірки — у файлі `.dev.vars`. Локальні дані
лежать у `.wrangler/state/`; видалити цю папку = скинути все до початкового.

Примітка: при першому запуску wrangler може ~20–30 с намагатися звернутися до
мережі (попередження `Unable to fetch the Request.cf object`) — це не помилка.

Перегляд лише сторінки без адмінки: `python3 -m http.server 8765 --directory site`.

## Демо-файл для клієнта

```bash
python3 scripts/build-demo.py
```

Створює `dist/zbirka-mebliv-demo.html` — один файл (~25 КБ), який
відкривається подвійним кліком без сервера. Прайс і фото з `site/content/`
вбудовані; форма в демо-режимі нічого не надсилає; адмінки немає. Фото,
завантажені через адмінку на сервері, в демо не потрапляють (лише локальні
`/images/...`, якщо їх покласти в `site/images/` і вказати в photos.json).

## Публікація на Cloudflare (перший раз)

Стан на 2026-10-08: кроки 1–3 виконано (акаунт власника Artemrd1@gmail.com,
`wrangler login`, KV-сховище, проєкт Pages `zbirka-mebliv`). Лишилися
кроки 4–7. Команди `npm run deploy` і `npm run secret` уже містять id
акаунта власника, бо у `wrangler login` видно два акаунти.

1. Зареєструватися на https://dash.cloudflare.com (безкоштовно, картка не потрібна).
2. У папці проєкту (`zbirka-mebliv-site`):
   ```bash
   npm install
   npx wrangler login
   ```
   (відкриється браузер, підтвердити доступ)
3. Створити сховище і вписати його `id` у `wrangler.toml`, створити проєкт:
   ```bash
   CLOUDFLARE_ACCOUNT_ID=<id акаунта> npx wrangler kv namespace create CONTENT
   CLOUDFLARE_ACCOUNT_ID=<id акаунта> npx wrangler pages project create zbirka-mebliv --production-branch main
   ```
4. Перша публікація:
   ```bash
   npm run deploy
   ```
5. Задати секрети (кожна команда попросить ввести значення):
   ```bash
   npm run secret -- ADMIN_LOGIN
   npm run secret -- ADMIN_PASSWORD
   npm run secret -- TG_BOT_TOKEN
   npm run secret -- TG_CHAT_ID
   ```
   Пароль — довгий (12+ символів), не той, що від пошти чи банку.
6. Ще раз `npm run deploy`, щоб секрети підхопилися.
7. Перевірити: сайт `https://zbirka-mebliv.pages.dev`, адмінка `/admin`
   (одразу змінити пароль), тестова заявка → має прийти в Telegram.

### Оновлення сайту потім

Змінили файли в `site/` або `functions/` → `npm run deploy`. Прайс і фото,
змінені через адмінку, при цьому **не перезаписуються** (вони в KV).

### Підключення домену

Workers & Pages → проєкт → **Custom domains** → додати домен. Деталі —
[05-hosting-domain.md](05-hosting-domain.md).

## Що перевірено (2026-10-06, локально через `wrangler pages dev`)

- вхід: без сесії → 401; без `X-Admin` → 400; невірний пароль → 401; вірний → cookie `HttpOnly; Secure; SameSite=Strict`;
- прайс: порожня назва відхиляється; збереження → одразу видно в `/api/content` і на сайті;
- фото: PNG/JPG завантажуються, віддаються ідентичними; TXT відхиляється; без сесії → 401;
  чуже посилання (`https://...`) в photos відхиляється; `../` у шляху → 404;
  фото 3000×2000 зменшується в браузері до 1600×1067;
- пароль: невірний поточний / короткий новий відхиляються; після зміни старий не діє,
  новий діє, поточна сесія лишається, інші завершуються;
- вихід завершує сесію; 6-та невдала спроба входу → 429 (блок 15 хв);
- сайт на телефоні (375 px) і комп'ютері; демо-файл з диска.

Пересилання в Telegram перевірено на живому сайті 2026-10-08: тестова заявка з фото прийшла власнику.
