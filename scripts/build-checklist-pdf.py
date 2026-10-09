#!/usr/bin/env python3
"""Збирає docs/09-checklist-vlasnyka.md у PDF для власника → dist/checklist-vlasnyka.pdf.

Стиль — як на сайті («Теплий майстер»): кремовий фон, коричневі заголовки,
квадратики-чекбокси, які можна відмічати на роздруківці.
Потрібно: python3 -m pip install --user reportlab
"""
import re
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (KeepTogether, Paragraph, SimpleDocTemplate,
                                Spacer, Table, TableStyle)

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "docs" / "09-checklist-vlasnyka.md"
OUT = ROOT / "dist" / "checklist-vlasnyka.pdf"

# Кольори з site/styles.css
BG = colors.HexColor("#fdf6ea")
CARD = colors.HexColor("#fffaf2")
LINE = colors.HexColor("#f0d6a8")
ACCENT = colors.HexColor("#854f0b")
TEXT = colors.HexColor("#412402")
MUTED = colors.HexColor("#7a5523")
HEAD_BG = colors.HexColor("#633806")
MARK = colors.HexColor("#fac775")

FONTS = Path("/System/Library/Fonts/Supplemental")
pdfmetrics.registerFont(TTFont("Body", FONTS / "Arial.ttf"))
pdfmetrics.registerFont(TTFont("Body-Bold", FONTS / "Arial Bold.ttf"))
pdfmetrics.registerFont(TTFont("Body-Italic", FONTS / "Arial Italic.ttf"))
pdfmetrics.registerFont(TTFont("Body-BoldItalic", FONTS / "Arial Bold Italic.ttf"))
pdfmetrics.registerFontFamily("Body", normal="Body", bold="Body-Bold",
                              italic="Body-Italic", boldItalic="Body-BoldItalic")

S = {
    "h1": ParagraphStyle("h1", fontName="Body-Bold", fontSize=22, leading=27, textColor=TEXT, spaceAfter=4),
    "h2": ParagraphStyle("h2", fontName="Body-Bold", fontSize=14.5, leading=18, textColor=TEXT,
                         spaceBefore=12, spaceAfter=6, keepWithNext=1),
    "p": ParagraphStyle("p", fontName="Body", fontSize=10.5, leading=15, textColor=TEXT, spaceAfter=6),
    "lead": ParagraphStyle("lead", fontName="Body", fontSize=10.5, leading=15, textColor=MUTED, spaceAfter=6),
    "item": ParagraphStyle("item", fontName="Body", fontSize=10.5, leading=15, textColor=TEXT),
    "num": ParagraphStyle("num", fontName="Body", fontSize=10.5, leading=15, textColor=TEXT,
                          leftIndent=16, firstLineIndent=-16, spaceAfter=2),
    "foot": ParagraphStyle("foot", fontName="Body", fontSize=8.5, textColor=MUTED),
}


def inline(text):
    """Markdown-рядок → розмітка Paragraph."""
    # Символи, яких немає в Arial
    for a, b in (("\\*", "*"), ("☰", "три смужки"), (" ↗", ""), ("✕", "×")):
        text = text.replace(a, b)
    text = text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
    text = re.sub(r"\*\*(.+?)\*\*", r"<b>\1</b>", text)
    text = re.sub(r"`(.+?)`", r'<font face="Courier" color="#854f0b">\1</font>', text)
    text = re.sub(r"\[(.+?)\]\((.+?)\)", r'<u><font color="#854f0b">\1</font></u>', text)
    text = re.sub(r"(https?://[^\s,;)]+)", r'<u><font color="#854f0b">\1</font></u>', text)
    text = re.sub(r"\s*—\s*", " — ", text)
    return text


TABLE_STYLE = TableStyle([
    ("VALIGN", (0, 0), (-1, -1), "TOP"),
    ("LEFTPADDING", (0, 0), (0, -1), 1 * mm),
    ("RIGHTPADDING", (0, 0), (0, -1), 0),
    ("LEFTPADDING", (1, 0), (1, -1), 2 * mm),
    ("TOPPADDING", (0, 0), (-1, -1), 2.2 * mm),
    ("BOTTOMPADDING", (0, 0), (-1, -1), 2.2 * mm),
    ("LINEBELOW", (0, 0), (-1, -2), 0.4, LINE),
])


class CheckTable(Table):
    """Таблиця пунктів; у першій колонці малює квадратик для відмітки."""

    def draw(self):
        Table.draw(self)
        c = self.canv
        c.saveState()
        c.setStrokeColor(ACCENT); c.setLineWidth(0.9); c.setFillColor(CARD)
        y, box = self._height, 4.2 * mm
        for rh in self._rowHeights:
            c.roundRect(2 * mm, y - 2.2 * mm - box - 0.6 * mm, box, box, 0.8 * mm, stroke=1, fill=1)
            y -= rh
        c.restoreState()


def checkbox_table(items):
    rows = [["", Paragraph(inline(t), S["item"])] for t in items]
    t = CheckTable(rows, colWidths=[9 * mm, None])
    t.setStyle(TABLE_STYLE)
    return t


def build():
    lines = SRC.read_text(encoding="utf-8").splitlines()
    story, para, items, nums = [], [], [], []
    title = None
    first_lead = True

    def flush_para():
        nonlocal para, first_lead
        if para:
            txt = " ".join(s.strip() for s in para)
            style = S["lead"] if (first_lead and title and not story[1:]) else S["p"]
            story.append(Paragraph(inline(txt), style))
            para = []

    def flush_items():
        nonlocal items
        if items:
            story.append(checkbox_table(items))
            items = []

    def flush_nums():
        nonlocal nums
        if nums:
            for i, t in enumerate(nums, 1):
                story.append(Paragraph(f"<b>{i}.</b>&nbsp;&nbsp;{inline(t)}", S["num"]))
            nums = []

    for ln in lines:
        if ln.startswith("# "):
            title = ln[2:].strip()
            story.append(Paragraph(inline(title), S["h1"]))
            continue
        if ln.startswith("## "):
            flush_para(); flush_items(); flush_nums()
            story.append(Paragraph(inline(ln[3:].strip()), S["h2"]))
            continue
        if ln.startswith("- [ ] "):
            flush_para(); flush_nums()
            items.append(ln[6:].strip())
            continue
        m = re.match(r"^(\d+)\. (.*)", ln)
        if m:
            flush_para(); flush_items()
            nums.append(m.group(2).strip())
            continue
        if ln.startswith("      ") and items:
            items[-1] += " " + ln.strip(); continue
        if ln.startswith("   ") and nums:
            nums[-1] += " " + ln.strip(); continue
        if not ln.strip():
            flush_para(); flush_items(); flush_nums()
            continue
        if items and not ln.startswith("- "):
            flush_items()
        para.append(ln)
    flush_para(); flush_items(); flush_nums()

    def on_page(canvas, doc):
        w, h = A4
        canvas.saveState()
        canvas.setFillColor(BG); canvas.rect(0, 0, w, h, stroke=0, fill=1)
        # Шапка, як на сайті
        canvas.setFillColor(HEAD_BG); canvas.rect(0, h - 16 * mm, w, 16 * mm, stroke=0, fill=1)
        canvas.setFillColor(MARK); canvas.roundRect(14 * mm, h - 12.5 * mm, 9 * mm, 9 * mm, 2 * mm, stroke=0, fill=1)
        canvas.setFillColor(HEAD_BG); canvas.setFont("Body-Bold", 11)
        canvas.drawCentredString(18.5 * mm, h - 10.6 * mm, "М")
        canvas.setFillColor(colors.white); canvas.setFont("Body-Bold", 12)
        canvas.drawString(26 * mm, h - 7.8 * mm, "Майстер Меблів")
        canvas.setFont("Body", 8.5); canvas.setFillColor(colors.HexColor("#f6e3c3"))
        canvas.drawString(26 * mm, h - 12.3 * mm, "Хмельницький та район")
        canvas.setFont("Body-Bold", 10); canvas.setFillColor(colors.white)
        canvas.drawRightString(w - 14 * mm, h - 10.2 * mm, "096 975 86 15")
        # Підвал
        canvas.setFont("Body", 8.5); canvas.setFillColor(MUTED)
        canvas.drawString(14 * mm, 9 * mm, "Чек-лист перевірки сайту · docs/09-checklist-vlasnyka.md")
        canvas.drawRightString(w - 14 * mm, 9 * mm, f"стор. {doc.page}")
        canvas.restoreState()

    OUT.parent.mkdir(exist_ok=True)
    doc = SimpleDocTemplate(str(OUT), pagesize=A4, leftMargin=14 * mm, rightMargin=14 * mm,
                            topMargin=24 * mm, bottomMargin=16 * mm,
                            title=title or "Чек-лист", author="Майстер Меблів")
    doc.build(story, onFirstPage=on_page, onLaterPages=on_page)
    print(f"Готово: {OUT.relative_to(ROOT)} ({OUT.stat().st_size // 1024} КБ)")


if __name__ == "__main__":
    build()
