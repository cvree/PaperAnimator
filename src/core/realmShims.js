/**
 * Shims that pdf.js 6 needs, written so they can be installed in ANY realm.
 *
 * pdf.js 6 uses the very recent Map.getOrInsert / getOrInsertComputed proposal.
 * Browsers that are otherwise perfectly capable of running this app do not have
 * it yet, so we supply it rather than telling those users their browser is too
 * old for a PDF reader.
 *
 * This file is deliberately plain, side-effecting JavaScript with no imports,
 * because it is used two ways:
 *   1. imported for its side effect on the main thread (see polyfills.ts), and
 *   2. read as raw text and prepended to the pdf.js worker source (see
 *      extract/pdf.ts).
 *
 * That second use is the point. A Web Worker is a separate realm with its own
 * Map.prototype, so a polyfill installed on the main thread does not exist
 * inside the worker — and the worker is where pdf.js does its parsing. Patching
 * only the main thread leaves the actual PDF reader running unpatched.
 */
(function installRealmShims() {
  function define(target, name, value) {
    if (typeof target[name] !== 'function') {
      Object.defineProperty(target, name, {
        value: value,
        writable: true,
        configurable: true,
      });
    }
  }

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
})();
