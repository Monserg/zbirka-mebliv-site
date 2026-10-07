#!/usr/bin/env python3
"""Збирає демо-версію сайту в ОДИН HTML-файл для перегляду клієнтом.

Файл відкривається подвійним кліком (без сервера): стилі, скрипт, прайс і фото
вбудовані всередину. Форма заявки працює в демо-режимі (нічого не надсилає).
Адмінки в демо-версії немає — для неї потрібна публікація на Cloudflare.

Запуск (з папки проєкту):  python3 scripts/build-demo.py
Результат:                  dist/zbirka-mebliv-demo.html
"""
import base64
import json
import mimetypes
import re
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SITE = ROOT / "site"
OUT = ROOT / "dist" / "zbirka-mebliv-demo.html"


def inline_image(src: str) -> str:
    """Локальне фото (/images/...) вбудовуємо як data: URI; фото з адмінки (/photos/...) у демо недоступні."""
    if not src:
        return ""
    path = SITE / src.lstrip("/")
    if src.startswith("/images/") and path.is_file():
        mime = mimetypes.guess_type(path.name)[0] or "image/jpeg"
        return f"data:{mime};base64,{base64.b64encode(path.read_bytes()).decode()}"
    return ""


def main() -> None:
    html = (SITE / "index.html").read_text(encoding="utf-8")
    css = (SITE / "styles.css").read_text(encoding="utf-8")
    js = (SITE / "main.js").read_text(encoding="utf-8")
    prices = json.loads((SITE / "content" / "prices.json").read_text(encoding="utf-8"))
    photos = json.loads((SITE / "content" / "photos.json").read_text(encoding="utf-8"))

    for p in photos.get("gallery", []):
        p["image"] = inline_image(p.get("image", ""))

    content = json.dumps({"prices": prices, "photos": photos}, ensure_ascii=False).replace("</", "<\\/")
    today = date.today().strftime("%d.%m.%Y")

    html = html.replace('<link rel="stylesheet" href="styles.css">', f"<style>\n{css}\n</style>")
    html = html.replace(
        '<script src="main.js"></script>',
        f"<script>window.__DEMO__ = true; window.__CONTENT__ = {content};</script>\n<script>\n{js}\n</script>",
    )
    html = re.sub(
        r'<div class="draft">.*?</div>',
        f'<div class="draft">Демо-версія для перегляду ({today}). Фото робіт і Telegram ще не додані; форма заявки нічого не надсилає</div>',
        html,
        count=1,
        flags=re.S,
    )
    html = html.replace("<title>", "<title>[Демо] ", 1)
    html = html.replace('<meta name="viewport"', '<meta name="robots" content="noindex">\n<meta name="viewport"', 1)

    OUT.parent.mkdir(exist_ok=True)
    OUT.write_text(html, encoding="utf-8")
    print(f"Готово: {OUT.relative_to(ROOT)} ({OUT.stat().st_size // 1024} КБ)")


if __name__ == "__main__":
    main()
