// Vercel Serverless Function — POST /api/parse
// Turns pasted recipe text (or a photo) into the app's recipe JSON using Claude.
// INACTIVE until you add an ANTHROPIC_API_KEY env var in Vercel project settings.
export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Use POST" });
  if (!process.env.ANTHROPIC_API_KEY)
    return res.status(501).json({ error: "AI import not configured. Add ANTHROPIC_API_KEY in Vercel settings." });

  const { text, imageBase64 } = req.body || {};
  const content = [];
  if (imageBase64)
    content.push({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: imageBase64 } });
  content.push({ type: "text", text:
    `Convert this recipe into JSON matching exactly this shape (JSON only, no commentary):
{id,name,category,emoji,yield,totalTime,difficulty,summary,ingredients:[{item,group?}],tips:[string],steps:[{title,instruction,tip?,timer?:{seconds,label,rangeText}}]}.
Detect timed steps and set timer.seconds (use the lower end of any range). Split any step that has two distinct timeframes (e.g. stretch-and-folds vs. a long bulk rise) into two steps.
Recipe:\n\n${text || "(see image)"}` });

  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: "claude-sonnet-4-6", max_tokens: 2000, messages: [{ role: "user", content }] })
    });
    const data = await r.json();
    const jsonText = (data.content?.[0]?.text || "{}").replace(/^```json|```$/g, "").trim();
    return res.status(200).json(JSON.parse(jsonText));
  } catch (e) {
    return res.status(500).json({ error: "Parse failed", detail: String(e) });
  }
}
