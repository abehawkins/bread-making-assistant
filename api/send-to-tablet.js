// Vercel Serverless Function — POST /api/send-to-tablet
// Body: { recipe: <recipe JSON in the app's data model> }
// Renders the same kitchen-friendly, e-ink-optimized PDF as make_kitchen_pdfs.py
// (445x594pt, base-14 Helvetica, pure black on white) and uploads it to the
// reMarkable cloud via rmapi-js, into the "Recipes" folder (created if missing).
// Requires REMARKABLE_DEVICE_TOKEN env var (one-time pairing done 2026-07-16).

import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { remarkable, GenerationError } from "rmapi-js";

// ---------------------------------------------------------------------------
// Page geometry — mirrors make_kitchen_pdfs.py (reMarkable 2 ~3:4 portrait)
// ---------------------------------------------------------------------------
const PAGE_W = 445;
const PAGE_H = 594;
const M_LEFT = 40;
const M_RIGHT = 40;
const M_TOP = 44;
const M_BOTTOM = 56;
const FOOTER_Y = 26;
const CONTENT_W = PAGE_W - M_LEFT - M_RIGHT; // 365

// ---------------------------------------------------------------------------
// Text sanitization — keep everything renderable in base-14 Helvetica
// (WinAnsi). Strip emoji, remap typographic chars the font can't take.
// ---------------------------------------------------------------------------
const CHAR_MAP = {
  "≈": "~", // ≈
  "️": "", // variation selector-16
  "‑": "-", // non-breaking hyphen
  " ": " ", // nbsp -> plain space (keeps wrapping simple)
};
// chars > 0xFF that WinAnsi *does* support — pass through untouched
const WINANSI_EXTRA = new Set(
  "€‚ƒ„…†‡ˆ‰Š‹ŒŽ" +
  "‘’“”•–—˜™š›œžŸ"
);

function sanitize(text) {
  if (!text) return "";
  let out = "";
  for (const ch of String(text)) {
    const cp = ch.codePointAt(0);
    if (ch in CHAR_MAP) { out += CHAR_MAP[ch]; continue; }
    if (cp >= 0x1f000) continue; // emoji / pictographs
    if (cp < 0x20) { out += " "; continue; } // control chars -> space
    if (cp <= 0xff && !(cp >= 0x80 && cp <= 0x9f)) { out += ch; continue; }
    if (WINANSI_EXTRA.has(ch)) { out += ch; continue; }
    const ascii = ch.normalize("NFKD").replace(/[^\x20-\x7e]/g, "");
    out += ascii;
  }
  return out.replace(/\s+/g, " ").trim();
}

// ---------------------------------------------------------------------------
// Tiny flow-layout engine (paragraphs, columns, keep-together blocks,
// two-pass footer) on top of pdf-lib.
// ---------------------------------------------------------------------------
function wrapText(text, font, size, maxWidth) {
  const words = text.split(" ").filter(Boolean);
  const lines = [];
  let line = "";
  for (const w of words) {
    const cand = line ? line + " " + w : w;
    if (font.widthOfTextAtSize(cand, size) <= maxWidth || !line) line = cand;
    else { lines.push(line); line = w; }
  }
  if (line) lines.push(line);
  return lines;
}

function paraHeight(p, fonts, maxWidth) {
  const font = fonts[p.font];
  const lines = wrapText(p.text, font, p.size, maxWidth - (p.indent || 0));
  return (p.before || 0) + lines.length * p.leading + (p.after || 0);
}

function drawPara(page, p, fonts, x, y, maxWidth) {
  // y = current top-of-paragraph cursor; returns new cursor after drawing
  const font = fonts[p.font];
  y -= p.before || 0;
  const lines = wrapText(p.text, font, p.size, maxWidth - (p.indent || 0));
  for (const line of lines) {
    page.drawText(line, {
      x: x + (p.indent || 0),
      y: y - p.size, // approx baseline from top-of-line
      size: p.size,
      font,
      color: rgb(0, 0, 0),
    });
    y -= p.leading;
  }
  return y - (p.after || 0);
}

// Paragraph style helpers — sizes/leading mirror make_kitchen_pdfs.py
const S = {
  title: (t) => ({ text: t, font: "bold", size: 18, leading: 21, after: 4 }),
  meta: (t) => ({ text: t, font: "reg", size: 10, leading: 13, after: 4 }),
  summary: (t) => ({ text: t, font: "obl", size: 10, leading: 13, after: 6 }),
  section: (t) => ({ text: t, font: "bold", size: 12, leading: 15, before: 4, after: 6 }),
  group: (t) => ({ text: t, font: "bold", size: 10, leading: 13, before: 6, after: 3 }),
  ingredient: (t) => ({ text: t, font: "reg", size: 9, leading: 12, after: 2, indent: 4 }),
  stepHeader: (t) => ({ text: t, font: "bold", size: 10, leading: 13, after: 4 }),
  stepBody: (t) => ({ text: t, font: "reg", size: 10, leading: 13, after: 4 }),
  timer: (t) => ({ text: t, font: "bold", size: 9, leading: 11, before: 2, after: 4 }),
  tip: (t) => ({ text: t, font: "obl", size: 9, leading: 12, after: 4, indent: 4 }),
};

function formatTimerLine(timer) {
  if (!timer) return null;
  const label = timer.label || "";
  const rangeText = timer.rangeText || "";
  if (rangeText && label) return `TIMER: ${rangeText} -- ${label}`;
  if (rangeText) return `TIMER: ${rangeText}`;
  if (timer.seconds) return `TIMER: ${Math.round(timer.seconds / 60)} min`;
  return null;
}

export async function renderKitchenPdf(recipe) {
  const doc = await PDFDocument.create();
  doc.setTitle(sanitize(recipe.name || "Recipe"));
  doc.setAuthor("Recipe Assistant");
  const fonts = {
    reg: await doc.embedFont(StandardFonts.Helvetica),
    bold: await doc.embedFont(StandardFonts.HelveticaBold),
    obl: await doc.embedFont(StandardFonts.HelveticaOblique),
  };

  const name = sanitize(recipe.name || "Untitled Recipe");
  const ingredients = recipe.ingredients || [];
  const steps = recipe.steps || [];
  const tips = recipe.tips || [];

  let page = doc.addPage([PAGE_W, PAGE_H]);
  const topY = PAGE_H - M_TOP;

  // --- Page 1 header: two columns ---------------------------------------
  // Left col (w=175): title, meta, summary, general tips
  // Right col (w=170, x=+195): ingredients
  const colLw = 175, colRx = M_LEFT + 175 + 20, colRw = 170;

  const leftParas = [S.title(name)];
  const metaBits = [recipe.yield, recipe.totalTime, recipe.difficulty]
    .map(sanitize).filter(Boolean);
  if (metaBits.length) leftParas.push(S.meta(metaBits.join("  •  ")));
  if (recipe.summary) leftParas.push(S.summary(sanitize(recipe.summary)));
  if (tips.length) {
    leftParas.push(S.section("General Tips"));
    for (const t of tips) leftParas.push(S.ingredient("• " + sanitize(t)));
  }

  const rightParas = [S.section("Ingredients")];
  if (ingredients.length) {
    const hasGroups = ingredients.some((i) => i.group);
    if (hasGroups) {
      let last = null;
      for (const ing of ingredients) {
        const grp = ing.group || "Other";
        if (grp !== last) { rightParas.push(S.group(sanitize(grp))); last = grp; }
        rightParas.push(S.ingredient("• " + sanitize(ing.item || "")));
      }
    } else {
      for (const ing of ingredients)
        rightParas.push(S.ingredient("• " + sanitize(ing.item || "")));
    }
  } else {
    rightParas.push(S.ingredient("(No ingredients listed.)"));
  }

  let yL = topY, yR = topY;
  for (const p of leftParas) yL = drawPara(page, p, fonts, M_LEFT, yL, colLw);
  for (const p of rightParas) yR = drawPara(page, p, fonts, colRx, yR, colRw);
  let y = Math.min(yL, yR) - 6;

  // divider line
  page.drawLine({
    start: { x: M_LEFT, y }, end: { x: PAGE_W - M_RIGHT, y },
    thickness: 0.5, color: rgb(0, 0, 0),
  });
  y -= 12;

  // --- Instructions: flow with keep-together blocks ----------------------
  const newPage = () => { page = doc.addPage([PAGE_W, PAGE_H]); y = topY; };
  const ensure = (h) => {
    const full = topY - M_BOTTOM;
    if (y - h < M_BOTTOM && h <= full) newPage();
  };

  const sec = S.section("Instructions");
  ensure(paraHeight(sec, fonts, CONTENT_W));
  y = drawPara(page, sec, fonts, M_LEFT, y, CONTENT_W);

  steps.forEach((step, idx) => {
    const block = [];
    let header = `Step ${idx + 1} of ${steps.length}`;
    const t = sanitize(step.title || "");
    if (t) header += `  —  ${t}`;
    block.push(S.stepHeader(header));
    if (step.instruction) block.push(S.stepBody(sanitize(step.instruction)));
    const timerLine = formatTimerLine(step.timer);
    if (timerLine) block.push(S.timer(sanitize(timerLine)));
    if (step.tip) block.push(S.tip("Tip: " + sanitize(step.tip)));

    const blockH = block.reduce((h, p) => h + paraHeight(p, fonts, CONTENT_W), 0);
    ensure(blockH); // keep-together: push whole block to next page if it fits there
    for (const p of block) {
      // safety: if an oversized block overflows mid-paragraph, continue on a new page
      if (y - paraHeight(p, fonts, CONTENT_W) < M_BOTTOM - 2 && paraHeight(p, fonts, CONTENT_W) <= topY - M_BOTTOM) newPage();
      y = drawPara(page, p, fonts, M_LEFT, y, CONTENT_W);
    }
    y -= 6;
  });

  // --- Footer pass (we now know the total page count) ---------------------
  const pages = doc.getPages();
  pages.forEach((pg, i) => {
    pg.drawLine({
      start: { x: M_LEFT, y: FOOTER_Y + 14 },
      end: { x: PAGE_W - M_RIGHT, y: FOOTER_Y + 14 },
      thickness: 0.5, color: rgb(0.55, 0.55, 0.55),
    });
    pg.drawText(name, { x: M_LEFT, y: FOOTER_Y, size: 11, font: fonts.reg, color: rgb(0, 0, 0) });
    const label = `Page ${i + 1} of ${pages.length}`;
    const w = fonts.reg.widthOfTextAtSize(label, 11);
    pg.drawText(label, { x: PAGE_W - M_RIGHT - w, y: FOOTER_Y, size: 11, font: fonts.reg, color: rgb(0, 0, 0) });
  });

  return doc.save();
}

// ---------------------------------------------------------------------------
// reMarkable cloud upload
// ---------------------------------------------------------------------------
async function uploadToRemarkable(token, docName, pdfBytes) {
  const api = await remarkable(token);

  // Find (or create) the "Recipes" folder at root level
  let parent = "";
  let entries = [];
  try { entries = await api.listItems(); } catch { entries = []; }
  const folder = entries.find(
    (e) => e.type === "CollectionType" &&
      (e.visibleName || "").toLowerCase() === "recipes" &&
      (!e.parent || e.parent === "")
  );
  if (folder) parent = folder.id;
  else {
    try { parent = (await api.putFolder("Recipes")).id; } catch { parent = ""; }
  }

  // Replace an existing doc of the same name in that folder (no duplicates)
  const existing = entries.filter(
    (e) => e.type === "DocumentType" &&
      e.visibleName === docName && (e.parent || "") === parent
  );
  for (const e of existing) {
    try { await api.delete(e.hash); } catch { /* non-fatal */ }
  }

  // putPdf can race on the server generation — retry a few times, then fall
  // back to the simple root upload so the recipe still arrives.
  let lastErr = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await api.putPdf(docName, pdfBytes, { parent });
    } catch (e) {
      lastErr = e;
      if (!(e instanceof GenerationError)) break;
    }
  }
  try {
    return await api.uploadPdf(docName, pdfBytes); // root, but it arrives
  } catch (e) {
    throw lastErr || e;
  }
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------
export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Use POST" });
  const token = process.env.REMARKABLE_DEVICE_TOKEN;
  if (!token)
    return res.status(501).json({ error: "Not configured: add REMARKABLE_DEVICE_TOKEN in Vercel settings." });

  const { recipe } = req.body || {};
  if (!recipe || !recipe.name)
    return res.status(400).json({ error: "POST { recipe } using the app's recipe JSON." });

  try {
    const pdfBytes = await renderKitchenPdf(recipe);
    const docName = sanitize(recipe.name);
    await uploadToRemarkable(token, docName, new Uint8Array(pdfBytes));
    return res.status(200).json({
      status: "success",
      message: `"${docName}" sent — it'll appear on the tablet when it syncs.`,
    });
  } catch (e) {
    console.error("send-to-tablet failed:", e);
    return res.status(502).json({ error: "Upload to reMarkable cloud failed", detail: String(e && e.message || e) });
  }
}
