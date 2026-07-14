// Vercel Serverless Function — POST /api/fetch-recipe
// Server-side fetches a recipe URL, extracts schema.org/Recipe JSON-LD, and maps it
// to the app's recipe JSON. If no Recipe JSON-LD is found, strips the page down to
// readable text and hands it back as {fallbackText} for the client to POST to
// /api/parse (the existing Claude-powered importer) — this avoids duplicating the
// Claude call in two endpoints and keeps this function dependency-free/deterministic.
export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Use POST" });

  const { url } = req.body || {};
  if (!url || typeof url !== "string")
    return res.status(400).json({ error: "Missing url", hint: "Provide a recipe page URL." });

  let target;
  try { target = new URL(url); }
  catch (e) { return res.status(400).json({ error: "Invalid URL", hint: "That doesn't look like a valid URL." }); }
  if (!/^https?:$/.test(target.protocol))
    return res.status(400).json({ error: "Unsupported URL", hint: "Only http/https URLs are supported." });

  const controller = new AbortController();
  const to = setTimeout(() => controller.abort(), 10000);
  let html;
  try {
    const r = await fetch(target.toString(), {
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
      }
    });
    clearTimeout(to);
    if (!r.ok)
      return res.status(502).json({ error: `Fetch failed (${r.status})`, hint: "The site blocked the fetch — copy-paste the recipe text instead." });
    html = await r.text();
  } catch (e) {
    clearTimeout(to);
    const msg = e.name === "AbortError" ? "Request timed out" : "Network error fetching that page";
    return res.status(502).json({ error: msg, hint: "The site blocked the fetch — copy-paste the recipe text instead." });
  }

  try {
    const node = findRecipeNode(html);
    if (node) return res.status(200).json({ recipe: mapRecipeNode(node) });
  } catch (e) { /* fall through to fallback text */ }

  const fallbackText = htmlToReadableText(html).slice(0, 15000);
  if (!fallbackText || fallbackText.length < 40)
    return res.status(200).json({ error: "No recipe content found", hint: "Copy-paste the recipe text instead." });
  return res.status(200).json({ fallbackText });
}

// ---------- JSON-LD extraction ----------
function extractJsonLdBlocks(html) {
  const blocks = [];
  const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html))) blocks.push(m[1]);
  return blocks;
}
function collectNodes(parsed, out) {
  if (Array.isArray(parsed)) { parsed.forEach(p => collectNodes(p, out)); return; }
  if (parsed && typeof parsed === "object") {
    if (Array.isArray(parsed["@graph"])) parsed["@graph"].forEach(p => collectNodes(p, out));
    out.push(parsed);
  }
}
function isRecipeNode(node) {
  if (!node || !node["@type"]) return false;
  const t = node["@type"];
  const arr = Array.isArray(t) ? t : [t];
  return arr.some(x => typeof x === "string" && x.toLowerCase() === "recipe");
}
function findRecipeNode(html) {
  for (const raw of extractJsonLdBlocks(html)) {
    let jsonStr = raw.trim()
      .replace(/^<!--/, "").replace(/-->$/, "")
      .replace(/^\/\*<!\[CDATA\[\*\//, "").replace(/\/\*\]\]>\*\/$/, "");
    let parsed;
    try { parsed = JSON.parse(jsonStr); } catch (e) { continue; }
    const nodes = [];
    collectNodes(parsed, nodes);
    const recipe = nodes.find(isRecipeNode);
    if (recipe) return recipe;
  }
  return null;
}

// ---------- text helpers ----------
function decodeEntities(str) {
  if (!str) return "";
  return String(str)
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(n))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&(amp|lt|gt|quot|apos|#39|nbsp);/g, (_, e) => ({ amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", "#39": "'", nbsp: " " }[e]));
}
function stripHtml(str) {
  if (!str) return "";
  return decodeEntities(String(str).replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}
function htmlToReadableText(html) {
  let h = html
    .replace(/<!--([\s\S]*?)-->/g, "")
    .replace(/<(script|style|nav)[^>]*>[\s\S]*?<\/\1>/gi, "")
    .replace(/<[^>]+>/g, " ");
  h = decodeEntities(h).replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n").trim();
  return h;
}

// ---------- ISO8601 duration ----------
function isoDurationToSeconds(str) {
  if (!str || typeof str !== "string") return null;
  const m = /^P(?:(\d+)Y)?(?:(\d+)M)?(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/.exec(str.trim());
  if (!m) return null;
  const [, y, mo, w, d, h, mi, s] = m;
  if (!y && !mo && !w && !d && !h && !mi && !s) return null;
  let secs = 0;
  secs += (+y || 0) * 365 * 86400;
  secs += (+mo || 0) * 30 * 86400;
  secs += (+w || 0) * 7 * 86400;
  secs += (+d || 0) * 86400;
  secs += (+h || 0) * 3600;
  secs += (+mi || 0) * 60;
  secs += (+s || 0);
  return secs;
}
function humanizeSeconds(total) {
  if (total == null || isNaN(total) || total <= 0) return "";
  const h = Math.floor(total / 3600), m = Math.round((total % 3600) / 60);
  const parts = [];
  if (h) parts.push(h + "h");
  if (m) parts.push(m + "m");
  if (!parts.length) parts.push(Math.round(total) + "s");
  return parts.join(" ");
}

// ---------- field mappers ----------
function firstYield(y) {
  if (!y) return "";
  if (Array.isArray(y)) y = y[0];
  if (y && typeof y === "object") return stripHtml(String(y.value || y.name || ""));
  return stripHtml(String(y));
}
function guessCategory(node) {
  const raw = node.recipeCategory || "";
  const c = (Array.isArray(raw) ? raw.join(" ") : String(raw)).toLowerCase();
  if (/dessert|cake|cookie|sweet|candy|pie/.test(c)) return "Desserts";
  if (/drink|beverage|cocktail|smoothie/.test(c)) return "Drinks";
  if (/side|appetizer|snack|salad/.test(c)) return "Sides";
  return "Meals";
}
function deriveTitle(text) {
  if (!text) return "Step";
  const cut = text.split(/[.!?]/)[0] || text;
  return cut.slice(0, 40).trim() || "Step";
}
function splitPlainText(text) {
  let parts = text.split(/\n+/).map(s => s.trim()).filter(Boolean);
  if (parts.length > 1) return parts;
  const numbered = text.split(/(?=\d+[.)]\s)/).map(s => s.trim()).filter(Boolean);
  if (numbered.length > 1) return numbered.map(s => s.replace(/^\d+[.)]\s*/, ""));
  return [text];
}
function mapInstructions(instr) {
  const steps = [];
  if (!instr) return steps;
  const list = Array.isArray(instr) ? instr : [instr];
  for (const item of list) {
    if (item == null) continue;
    if (typeof item === "string") {
      const trimmed = stripHtml(item);
      if (!trimmed) continue;
      splitPlainText(trimmed).forEach(t => steps.push({ title: deriveTitle(t), instruction: t }));
      continue;
    }
    const types = (Array.isArray(item["@type"]) ? item["@type"] : [item["@type"]]).map(x => String(x || "").toLowerCase());
    if (types.includes("howtosection")) {
      const sectionName = stripHtml(item.name || "");
      const children = Array.isArray(item.itemListElement) ? item.itemListElement : (item.itemListElement ? [item.itemListElement] : []);
      children.forEach((child, idx) => {
        const text = typeof child === "string" ? stripHtml(child) : stripHtml(child.text || child.name || "");
        if (!text) return;
        const childName = (typeof child === "object" && child.name) ? stripHtml(child.name) : "";
        let title = childName || deriveTitle(text) || ("Step " + (idx + 1));
        if (sectionName) title = sectionName + " — " + title;
        steps.push({ title: title.slice(0, 60), instruction: text });
      });
    } else {
      const text = stripHtml(item.text || item.name || "");
      if (!text) continue;
      const title = stripHtml(item.name || "") || deriveTitle(text);
      steps.push({ title: title.slice(0, 60), instruction: text });
    }
  }
  return steps;
}
function mapRecipeNode(node) {
  const name = stripHtml(node.name || "Imported Recipe");
  let ingredientsRaw = node.recipeIngredient || node.ingredients || [];
  if (!Array.isArray(ingredientsRaw)) ingredientsRaw = [ingredientsRaw];
  const ingredients = ingredientsRaw
    .map(i => ({ item: stripHtml(typeof i === "string" ? i : (i.text || i.name || "")) }))
    .filter(i => i.item);

  let totalSeconds = isoDurationToSeconds(node.totalTime);
  if (totalSeconds == null) {
    const p = isoDurationToSeconds(node.prepTime) || 0;
    const c = isoDurationToSeconds(node.cookTime) || 0;
    if (p || c) totalSeconds = p + c;
  }

  const steps = mapInstructions(node.recipeInstructions);
  const summary = stripHtml(node.description || "");

  return {
    name,
    category: guessCategory(node),
    emoji: "🍽️",
    yield: firstYield(node.recipeYield),
    totalTime: totalSeconds ? humanizeSeconds(totalSeconds) : "",
    difficulty: "",
    summary,
    ingredients: ingredients.length ? ingredients : [{ item: "(add ingredients)" }],
    tips: [],
    steps: steps.length ? steps : [{ title: "Step 1", instruction: summary || "See original recipe for instructions." }]
  };
}
