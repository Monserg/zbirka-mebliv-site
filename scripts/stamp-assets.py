#!/usr/bin/env python3
"""Дописує до styles.css/main.js (і admin.css/admin.js) у HTML версію ?v=<хеш вмісту>.

Навіщо: на домені Cloudflare віддає css/js з max-age=14400, тож браузер до 4 годин
тримає старі файли, поки HTML уже новий (форма ламається). З новою версією в адресі
браузер одразу бере свіжий файл. Хеш міняється лише коли міняється файл.
Запускається автоматично з `npm run deploy`.
"""
import hashlib
import re
from pathlib import Path

SITE = Path(__file__).resolve().parent.parent / "site"
PAGES = [SITE / "index.html", SITE / "admin" / "index.html"]
ASSET = re.compile(r'((?:href|src)=")([\w./-]+\.(?:css|js))(?:\?v=[0-9a-f]+)?(")')


def stamp(page: Path) -> bool:
    html = page.read_text(encoding="utf-8")

    def repl(m: re.Match) -> str:
        asset = page.parent / m.group(2)
        if not asset.is_file():
            return m.group(0)
        h = hashlib.md5(asset.read_bytes()).hexdigest()[:8]
        return f"{m.group(1)}{m.group(2)}?v={h}{m.group(3)}"

    new = ASSET.sub(repl, html)
    if new != html:
        page.write_text(new, encoding="utf-8")
    return new != html


if __name__ == "__main__":
    for p in PAGES:
        print(("оновлено " if stamp(p) else "без змін ") + str(p.relative_to(SITE.parent)))
