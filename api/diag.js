// Retired diagnostic endpoint. Safe to delete this file entirely
// (git rm api/diag.js) on the next cleanup pass.
export default function handler(req, res) {
  res.status(410).json({ error: "diagnostics retired" });
}
