/**
 * Shims that pdf.js 6 needs, written so they can be installed in ANY realm.
 *
 * pdf.js 6 is built against several TC39 proposals that shipped in browsers
 * only very recently. A browser one version too old does not fail politely:
 * it throws deep inside the parser, which used to surface as "this PDF appears
 * to be damaged" for every file. Supplying the methods is far kinder than
 * telling somebody their browser is too old to read a PDF.
 *
 * Chrome 132, to take a real reported example, has none of these:
 *   Map.getOrInsert / getOrInsertComputed   — used in 16 places
 *   Uint8Array.prototype.toHex              — every document's fingerprint
 *   Uint8Array.prototype.toBase64           — embedded font data
 *   Uint8Array.fromBase64                   — embedded and compressed streams
 *   Promise.try                             — every worker message
 *   Response.prototype.bytes                — fetch-backed sources
 *
 * Float16Array is deliberately not shimmed: pdf.js feature-detects it through
 * FeatureTest.isFloat16ArraySupported and takes a different path when it is
 * missing, so faking it would replace a working fallback with a slower one.
 *
 * This file is deliberately plain, side-effecting JavaScript with no imports,
 * because it is used two ways:
 *   1. imported for its side effect on the main thread (see polyfills.ts), and
 *   2. read as raw text and prepended to the pdf.js worker source (see
 *      extract/pdf.ts).
 *
 * That second use is the point. A Web Worker is a separate realm with its own
 * intrinsics, so a polyfill installed on the main thread does not exist inside
 * the worker — and the worker is where pdf.js does its parsing. Patching only
 * the main thread leaves the actual PDF reader running unpatched.
 */
(function installRealmShims() {
  function define(target, name, value) {
    if (target && typeof target[name] !== 'function') {
      Object.defineProperty(target, name, {
        value: value,
        writable: true,
        configurable: true,
      });
    }
  }

  /* ---- Map / WeakMap.getOrInsert ------------------------------------- */

  function getOrInsert(key, value) {
    if (this.has(key)) return this.get(key);
    this.set(key, value);
    return value;
  }

  function getOrInsertComputed(key, compute) {
    if (this.has(key)) return this.get(key);
    var value = compute(key);
    this.set(key, value);
    return value;
  }

  define(Map.prototype, 'getOrInsert', getOrInsert);
  define(Map.prototype, 'getOrInsertComputed', getOrInsertComputed);
  define(WeakMap.prototype, 'getOrInsert', getOrInsert);
  define(WeakMap.prototype, 'getOrInsertComputed', getOrInsertComputed);

  /* ---- Promise.try ---------------------------------------------------- */

  // Calls fn synchronously and captures a synchronous throw as a rejection,
  // which is the whole point of the proposal.
  define(Promise, 'try', function tryFn(fn) {
    var args = Array.prototype.slice.call(arguments, 1);
    return new Promise(function (resolve) {
      resolve(fn.apply(undefined, args));
    });
  });

  /* ---- Uint8Array base64 / hex ---------------------------------------- */

  var HEX = [];
  for (var i = 0; i < 256; i++) {
    HEX.push((i < 16 ? '0' : '') + i.toString(16));
  }

  define(Uint8Array.prototype, 'toHex', function toHex() {
    var out = '';
    for (var i = 0; i < this.length; i++) out += HEX[this[i]];
    return out;
  });

  // Chunked so a large embedded font cannot overflow the argument stack.
  define(Uint8Array.prototype, 'toBase64', function toBase64(options) {
    var alphabet = (options && options.alphabet) || 'base64';
    var binary = '';
    var CHUNK = 0x8000;
    for (var i = 0; i < this.length; i += CHUNK) {
      binary += String.fromCharCode.apply(null, this.subarray(i, i + CHUNK));
    }
    var out = btoa(binary);
    if (alphabet === 'base64url') {
      out = out.replace(/\+/g, '-').replace(/\//g, '_');
    }
    if (options && options.omitPadding) out = out.replace(/=+$/, '');
    return out;
  });

  define(Uint8Array, 'fromBase64', function fromBase64(string, options) {
    var alphabet = (options && options.alphabet) || 'base64';
    var text = String(string);
    if (alphabet === 'base64url') {
      text = text.replace(/-/g, '+').replace(/_/g, '/');
    }
    // atob rejects unpadded input that the proposal accepts.
    var pad = text.length % 4;
    if (pad === 2) text += '==';
    else if (pad === 3) text += '=';
    var binary = atob(text);
    var bytes = new Uint8Array(binary.length);
    for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  });

  /* ---- Response.bytes ------------------------------------------------- */

  if (typeof Response === 'function') {
    define(Response.prototype, 'bytes', function bytes() {
      return this.arrayBuffer().then(function (buffer) {
        return new Uint8Array(buffer);
      });
    });
  }
})();
