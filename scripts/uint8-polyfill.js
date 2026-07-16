// Polyfill for the ES "Uint8Array to/from base64 and hex" proposal methods
// (Uint8Array.prototype.toHex/toBase64, Uint8Array.fromHex), which rmapi-js
// v11 relies on but Node < 24 (Vercel's runtime) doesn't ship yet.
// Must be imported BEFORE rmapi-js.

if (typeof Uint8Array.prototype.toHex !== "function") {
  Object.defineProperty(Uint8Array.prototype, "toHex", {
    value: function toHex() {
      let out = "";
      for (let i = 0; i < this.length; i++) out += this[i].toString(16).padStart(2, "0");
      return out;
    },
    writable: true,
    configurable: true,
  });
}

if (typeof Uint8Array.fromHex !== "function") {
  Object.defineProperty(Uint8Array, "fromHex", {
    value: function fromHex(hex) {
      if (typeof hex !== "string" || hex.length % 2 !== 0 || /[^0-9a-fA-F]/.test(hex)) {
        throw new SyntaxError("Invalid hex string");
      }
      const out = new Uint8Array(hex.length / 2);
      for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
      return out;
    },
    writable: true,
    configurable: true,
  });
}

if (typeof Uint8Array.prototype.toBase64 !== "function") {
  Object.defineProperty(Uint8Array.prototype, "toBase64", {
    value: function toBase64(opts) {
      const alphabet = opts && opts.alphabet === "base64url" ? "base64url" : "base64";
      let b64 = Buffer.from(this.buffer, this.byteOffset, this.byteLength).toString(alphabet);
      if (opts && opts.omitPadding) b64 = b64.replace(/=+$/, "");
      return b64;
    },
    writable: true,
    configurable: true,
  });
}

if (typeof Uint8Array.fromBase64 !== "function") {
  Object.defineProperty(Uint8Array, "fromBase64", {
    value: function fromBase64(str, opts) {
      const alphabet = opts && opts.alphabet === "base64url" ? "base64url" : "base64";
      return new Uint8Array(Buffer.from(str, alphabet));
    },
    writable: true,
    configurable: true,
  });
}
