// postinstall: fix rmapi-js's ESM import of "crc-32/crc32c" (missing .js
// extension), which breaks Node's native ESM resolution at runtime.
// Safe to run repeatedly; no-ops if rmapi-js isn't installed.
import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const dir = join(process.cwd(), "node_modules", "rmapi-js", "dist");
if (existsSync(dir)) {
  for (const f of readdirSync(dir)) {
    if (!f.endsWith(".js")) continue;
    const p = join(dir, f);
    const src = readFileSync(p, "utf8");
    const out = src.replace(/crc-32\/crc32c(?!\.js)/g, "crc-32/crc32c.js");
    if (out !== src) {
      writeFileSync(p, out);
      console.log("patched", p);
    }
  }
}
