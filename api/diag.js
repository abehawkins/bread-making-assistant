// TEMPORARY diagnostic endpoint — remove after send-to-tablet is stable.
// GET  /api/diag            -> list cloud entries (id, name, type, parent)
// GET  /api/diag?delete=ID  -> delete the entry with that id (sync repair)
export default async function handler(req, res) {
  const token = process.env.REMARKABLE_DEVICE_TOKEN;
  if (!token) return res.status(501).json({ error: "no token" });
  try {
    const { remarkable } = await import("rmapi-js");
    const api = await remarkable(token);
    const entries = await api.listItems(true);
    const list = entries.map((e) => ({
      id: e.id,
      hash: e.hash,
      name: e.visibleName,
      type: e.type,
      fileType: e.fileType,
      parent: e.parent ?? "",
      lastModified: e.lastModified,
    }));
    const del = req.query && req.query.delete;
    if (del) {
      const target = entries.find((e) => e.id === del);
      if (!target) return res.status(404).json({ error: "id not found", list });
      await api.delete(target.hash);
      return res.status(200).json({ deleted: { id: target.id, name: target.visibleName }, remaining: list.length - 1 });
    }
    return res.status(200).json({ count: list.length, list });
  } catch (e) {
    return res.status(502).json({ error: String(e && e.message || e), stack: String(e && e.stack || "").slice(0, 500) });
  }
}
