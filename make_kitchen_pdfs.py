#!/usr/bin/env python3
"""
make_kitchen_pdfs.py

Generates one kitchen-friendly, e-ink-optimized PDF per recipe for display on a
reMarkable 2 tablet (10.3", 1404x1872 px, grayscale, finger-touch page turns).

Reads:  vercel-site/data/*.json  (sibling of this script; skips index.json)
Writes: kitchen-pdfs/<recipe-id>.pdf  (sibling folder to vercel-site, created if needed)

Design notes (see report / HANDOFF for rationale):
- Page size ~445x594pt, matching the rM2's ~3:4 portrait aspect ratio.
- Pure black text on white, no fills/backgrounds — reads cleanly on e-ink.
- Only base-14 PDF fonts (Helvetica family) are used, so no font embedding is
  needed. Text is sanitized to strip emoji / exotic unicode (which the base
  fonts can't render) and swap in ASCII-safe equivalents (e.g. "≈" -> "~").
- Page 1: title, meta line (yield / time / difficulty), summary, then the
  full ingredient list (grouped under sub-headings where the data has groups).
- Following pages: one step per "block" via KeepTogether so a step is never
  split awkwardly across a page break; reportlab's automatic flow packs
  multiple short steps onto a page and pushes long ones to their own page,
  satisfying "one or few steps per page, never cram".
- Final page: general recipe tips (if any), so no data from the JSON is lost.
- Footer on every page: recipe name (left) + "Page N of M" (right), added via
  a NumberedCanvas subclass (two-pass: reportlab buffers pages, we learn the
  total count, then stamp every page's footer before final save).

Requires: reportlab (pure Python, no system dependencies).
    pip install reportlab --break-system-packages
"""

import json
import sys
import traceback
import unicodedata
from pathlib import Path
from xml.sax.saxutils import escape as xml_escape

from reportlab.lib.pagesizes import portrait
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import inch
from reportlab.pdfgen import canvas
from reportlab.platypus import (
    BaseDocTemplate,
    Frame,
    PageTemplate,
    Paragraph,
    Spacer,
    KeepTogether,
    PageBreak,
    Table,
    TableStyle,
)

# --------------------------------------------------------------------------
# Paths
# --------------------------------------------------------------------------
SCRIPT_DIR = Path(__file__).resolve().parent
DATA_DIR = SCRIPT_DIR / "vercel-site" / "data"
OUT_DIR = SCRIPT_DIR / "kitchen-pdfs"

# --------------------------------------------------------------------------
# Page geometry — reMarkable 2 is 1404x1872 px @ 226 dpi (~3:4 portrait).
# 445 x 594 pt matches that aspect ratio closely and is a size other rM2
# projects commonly use.
# --------------------------------------------------------------------------
PAGE_WIDTH = 445
PAGE_HEIGHT = 594
MARGIN_LEFT = 40
MARGIN_RIGHT = 40
MARGIN_TOP = 44
MARGIN_BOTTOM = 56  # leaves room below the content frame for the footer
FOOTER_Y = 26

BLACK = (0, 0, 0)

# --------------------------------------------------------------------------
# Text sanitization — keep everything renderable in base-14 Helvetica, which
# uses a WinAnsi-ish encoding. Strip emoji / variation selectors entirely
# (they render as blanks/tofu in these fonts) and remap the handful of other
# non-WinAnsi characters found in the data (checked against the whole corpus
# ahead of time) to safe ASCII equivalents.
# --------------------------------------------------------------------------
_EXPLICIT_MAP = {
    "≈": "~",       # ALMOST EQUAL TO -> tilde
    "️": "",         # VARIATION SELECTOR-16 -> drop
}


def sanitize(text):
    if not text:
        return ""
    out = []
    for ch in text:
        cp = ord(ch)
        if ch in _EXPLICIT_MAP:
            out.append(_EXPLICIT_MAP[ch])
            continue
        if cp >= 0x1F000:  # emoji / pictographs
            continue
        try:
            ch.encode("cp1252")
            out.append(ch)
        except UnicodeEncodeError:
            decomposed = unicodedata.normalize("NFKD", ch)
            ascii_ch = decomposed.encode("ascii", "ignore").decode("ascii")
            out.append(ascii_ch if ascii_ch else "")
    return "".join(out)


def safe_para_text(text):
    """Sanitize then XML-escape for use inside a reportlab Paragraph."""
    return xml_escape(sanitize(text))


# --------------------------------------------------------------------------
# Paragraph styles — large type, pure black, generous leading.
# --------------------------------------------------------------------------
def build_styles():
    return {
        "title": ParagraphStyle(
            "KitchenTitle", fontName="Helvetica-Bold", fontSize=18, leading=21,
            textColor=BLACK, spaceAfter=4,
        ),
        "meta": ParagraphStyle(
            "KitchenMeta", fontName="Helvetica", fontSize=10, leading=13,
            textColor=BLACK, spaceAfter=4,
        ),
        "summary": ParagraphStyle(
            "KitchenSummary", fontName="Helvetica-Oblique", fontSize=10, leading=13,
            textColor=BLACK, spaceAfter=6,
        ),
        "section": ParagraphStyle(
            "KitchenSection", fontName="Helvetica-Bold", fontSize=12, leading=15,
            textColor=BLACK, spaceBefore=4, spaceAfter=6,
        ),
        "group": ParagraphStyle(
            "KitchenGroup", fontName="Helvetica-Bold", fontSize=10, leading=13,
            textColor=BLACK, spaceBefore=6, spaceAfter=3,
        ),
        "ingredient": ParagraphStyle(
            "KitchenIngredient", fontName="Helvetica", fontSize=9, leading=12,
            textColor=BLACK, spaceAfter=2, leftIndent=4,
        ),
        "step_header": ParagraphStyle(
            "KitchenStepHeader", fontName="Helvetica-Bold", fontSize=10, leading=13,
            textColor=BLACK, spaceAfter=4,
        ),
        "step_body": ParagraphStyle(
            "KitchenStepBody", fontName="Helvetica", fontSize=10, leading=13,
            textColor=BLACK, spaceAfter=4,
        ),
        "timer": ParagraphStyle(
            "KitchenTimer", fontName="Helvetica-Bold", fontSize=9, leading=11,
            textColor=BLACK, spaceBefore=2, spaceAfter=4,
        ),
        "tip": ParagraphStyle(
            "KitchenTip", fontName="Helvetica-Oblique", fontSize=9, leading=12,
            textColor=BLACK, spaceAfter=4, leftIndent=4,
        ),
    }


# --------------------------------------------------------------------------
# Footer / page-numbering canvas (two-pass: buffer pages, then stamp footer
# with the final total page count on each one).
# --------------------------------------------------------------------------
def make_numbered_canvas(recipe_name):
    class NumberedCanvas(canvas.Canvas):
        def __init__(self, *args, **kwargs):
            canvas.Canvas.__init__(self, *args, **kwargs)
            self._saved_page_states = []

        def showPage(self):
            self._saved_page_states.append(dict(self.__dict__))
            self._startPage()

        def save(self):
            total = len(self._saved_page_states)
            for state in self._saved_page_states:
                self.__dict__.update(state)
                self._draw_footer(total)
                canvas.Canvas.showPage(self)
            canvas.Canvas.save(self)

        def _draw_footer(self, total):
            self.setFont("Helvetica", 11)
            self.setFillColorRGB(0, 0, 0)
            self.drawString(MARGIN_LEFT, FOOTER_Y, sanitize(recipe_name))
            self.drawRightString(
                PAGE_WIDTH - MARGIN_RIGHT, FOOTER_Y,
                "Page %d of %d" % (self._pageNumber, total),
            )
            self.setLineWidth(0.5)
            self.setStrokeColorRGB(0.55, 0.55, 0.55)
            self.line(MARGIN_LEFT, FOOTER_Y + 14, PAGE_WIDTH - MARGIN_RIGHT, FOOTER_Y + 14)

    return NumberedCanvas


# --------------------------------------------------------------------------
# Story (flowable content) construction
# --------------------------------------------------------------------------
def format_timer_line(timer):
    if not timer:
        return None
    label = timer.get("label") or ""
    range_text = timer.get("rangeText") or ""
    if range_text and label:
        return "TIMER: %s -- %s" % (range_text, label)
    if range_text:
        return "TIMER: %s" % range_text
    seconds = timer.get("seconds")
    if seconds:
        minutes = round(seconds / 60)
        return "TIMER: %d min" % minutes
    return None


def build_story(recipe, styles):
    story = []
    name = recipe.get("name", "Untitled Recipe")
    yield_ = recipe.get("yield", "")
    total_time = recipe.get("totalTime", "")
    difficulty = recipe.get("difficulty", "")
    summary = recipe.get("summary", "")
    ingredients = recipe.get("ingredients", []) or []
    steps = recipe.get("steps", []) or []
    tips = recipe.get("tips", []) or []

    # --- Left Column: Ingredients ---
    left_flowables = []
    left_flowables.append(Paragraph("Ingredients", styles["section"]))
    if ingredients:
        has_groups = any(ing.get("group") for ing in ingredients)
        if has_groups:
            seen_groups = []
            grouped = {}
            for ing in ingredients:
                grp = ing.get("group") or "Other"
                if grp not in grouped:
                    grouped[grp] = []
                    seen_groups.append(grp)
                grouped[grp].append(ing.get("item", ""))
            for grp in seen_groups:
                left_flowables.append(Paragraph(safe_para_text(grp), styles["group"]))
                for item in grouped[grp]:
                    left_flowables.append(Paragraph("• " + safe_para_text(item), styles["ingredient"]))
        else:
            for ing in ingredients:
                item = ing.get("item", "")
                left_flowables.append(Paragraph("• " + safe_para_text(item), styles["ingredient"]))
    else:
        left_flowables.append(Paragraph("(No ingredients listed.)", styles["ingredient"]))

    # --- Right Column: Title, Meta, Summary, General Tips ---
    right_flowables = []
    right_flowables.append(Paragraph(safe_para_text(name), styles["title"]))
    meta_bits = [b for b in (yield_, total_time, difficulty) if b]
    if meta_bits:
        meta_line = "  •  ".join(sanitize(b) for b in meta_bits)
        right_flowables.append(Paragraph(xml_escape(meta_line), styles["meta"]))
    if summary:
        right_flowables.append(Paragraph(safe_para_text(summary), styles["summary"]))
    if tips:
        right_flowables.append(Paragraph("General Tips", styles["section"]))
        for t in tips:
            right_flowables.append(Paragraph("• " + safe_para_text(t), styles["ingredient"]))

    # --- Combine Columns into a Table ---
    # Col widths sum to 365 (PAGE_WIDTH 445 - MARGIN_LEFT 40 - MARGIN_RIGHT 40)
    col1_w = 175
    gap_w = 20
    col2_w = 170
    
    table_data = [[right_flowables, [], left_flowables]]
    header_table = Table(table_data, colWidths=[col1_w, gap_w, col2_w])
    header_table.setStyle(TableStyle([
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
        ('TOPPADDING', (0, 0), (-1, -1), 0),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 0),
        ('LEFTPADDING', (0, 0), (-1, -1), 0),
        ('RIGHTPADDING', (0, 0), (-1, -1), 0),
    ]))
    
    story.append(header_table)
    story.append(Spacer(1, 6))

    # --- Draw a dividing line ---
    hr_table = Table([[""]], colWidths=[365], rowHeights=[2])
    hr_table.setStyle(TableStyle([
        ('LINEBELOW', (0, 0), (-1, -1), 0.5, BLACK),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 0),
        ('TOPPADDING', (0, 0), (-1, -1), 0),
    ]))
    story.append(hr_table)
    story.append(Spacer(1, 6))

    # --- Steps Section ---
    story.append(Paragraph("Instructions", styles["section"]))
    total_steps = len(steps)
    for idx, step in enumerate(steps, start=1):
        block = []
        title = step.get("title", "").strip()
        header_text = "Step %d of %d" % (idx, total_steps)
        if title:
            header_text += "  —  " + sanitize(title)
        block.append(Paragraph(xml_escape(header_text), styles["step_header"]))

        instruction = step.get("instruction", "")
        if instruction:
            block.append(Paragraph(safe_para_text(instruction), styles["step_body"]))

        timer_line = format_timer_line(step.get("timer"))
        if timer_line:
            block.append(Paragraph(xml_escape(sanitize(timer_line)), styles["timer"]))

        tip = step.get("tip")
        if tip:
            block.append(Paragraph("Tip: " + safe_para_text(tip), styles["tip"]))

        story.append(KeepTogether(block))
        story.append(Spacer(1, 6))

    return story


# --------------------------------------------------------------------------
# Per-recipe render
# --------------------------------------------------------------------------
def render_recipe_pdf(recipe, out_path):
    styles = build_styles()
    story = build_story(recipe, styles)

    doc = BaseDocTemplate(
        str(out_path),
        pagesize=(PAGE_WIDTH, PAGE_HEIGHT),
        leftMargin=MARGIN_LEFT,
        rightMargin=MARGIN_RIGHT,
        topMargin=MARGIN_TOP,
        bottomMargin=MARGIN_BOTTOM,
        title=sanitize(recipe.get("name", "Recipe")),
        author="Bread Making Assistant",
    )
    frame = Frame(
        MARGIN_LEFT, MARGIN_BOTTOM,
        PAGE_WIDTH - MARGIN_LEFT - MARGIN_RIGHT,
        PAGE_HEIGHT - MARGIN_TOP - MARGIN_BOTTOM,
        id="content",
    )
    doc.addPageTemplates([PageTemplate(id="recipe", frames=[frame])])

    canvas_maker = make_numbered_canvas(recipe.get("name", "Recipe"))
    doc.build(story, canvasmaker=canvas_maker)


# --------------------------------------------------------------------------
# Main
# --------------------------------------------------------------------------
def main():
    if not DATA_DIR.is_dir():
        print("ERROR: data directory not found: %s" % DATA_DIR, file=sys.stderr)
        sys.exit(1)

    OUT_DIR.mkdir(parents=True, exist_ok=True)

    json_files = sorted(
        p for p in DATA_DIR.glob("*.json") if p.name.lower() != "index.json"
    )

    if not json_files:
        print("No recipe JSON files found in %s" % DATA_DIR, file=sys.stderr)
        sys.exit(1)

    successes = []
    failures = []

    for jf in json_files:
        try:
            with open(jf, "r", encoding="utf-8") as f:
                recipe = json.load(f)
        except Exception as e:
            failures.append((jf.name, "JSON load error: %s" % e))
            traceback.print_exc()
            continue

        recipe_id = recipe.get("id") or jf.stem
        out_path = OUT_DIR / ("%s.pdf" % recipe_id)

        try:
            render_recipe_pdf(recipe, out_path)
            size = out_path.stat().st_size
            successes.append((recipe_id, out_path.name, size))
            print("OK   %-28s -> %s (%d bytes)" % (recipe_id, out_path.name, size))
        except Exception as e:
            failures.append((jf.name, "Render error: %s" % e))
            print("FAIL %-28s -> %s" % (recipe_id, e), file=sys.stderr)
            traceback.print_exc()

    total_size = sum(s for _, _, s in successes)
    print()
    print("=" * 60)
    print("Rendered %d/%d PDFs into %s" % (len(successes), len(json_files), OUT_DIR))
    print("Total size: %d bytes (%.1f KB)" % (total_size, total_size / 1024.0))
    if failures:
        print("FAILURES (%d):" % len(failures))
        for name, err in failures:
            print("  - %s: %s" % (name, err))
    print("=" * 60)

    if failures:
        sys.exit(2)


if __name__ == "__main__":
    main()
