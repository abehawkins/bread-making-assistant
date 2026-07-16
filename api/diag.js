// TEMPORARY diagnostic endpoint — remove after send-to-tablet is working.
export default async function handler(req, res) {
  const out = {
    node: process.version,
    cwd: process.cwd(),
    toHexNative: typeof Uint8Array.prototype.toHex,
    hasToken: Boolean(process.env.REMARKABLE_DEVICE_TOKEN),
  };
  try { await import("pdf-lib"); out.pdfLib = "ok"; }
  catch (e) { out.pdfLib = String(e); }
  try { await import("rmapi-js"); out.rmapiJs = "ok"; }
  catch (e) { out.rmapiJs = String(e); }
  try { await import("crc-32/crc32c.js"); out.crc32c = "ok"; }
  catch (e) { out.crc32c = String(e); }
  try {
    const fs = await import("node:fs");
    const dir = process.cwd() + "/node_modules/rmapi-js/dist";
    out.rmapiDist = fs.readdirSync(dir).join(",");
    const raw = fs.readFileSync(dir + "/raw.js", "utf8");
    out.rawJsPatched = raw.includes("crc-32/crc32c.js");
    out.rawJsImportLine = (raw.match(/from\s+"[^"]*crc[^"]*"/g) || []).join(" | ");
  } catch (e) { out.fsProbe = String(e); }
  try {
    const mod = await import("../api/send-to-tablet.js");
    out.sendToTabletModule = typeof mod.default === "function" ? "loads ok" : "loaded, no default";
  } catch (e) { out.sendToTabletModule = String(e && e.stack || e); }
  res.status(200).json(out);
}
