/**
 * pdf.js 6 uses the very recent Map.getOrInsert / getOrInsertComputed proposal.
 * Browsers that are otherwise perfectly capable of running this app do not have
 * it yet, so we supply it rather than telling those users their browser is too
 * old for a PDF reader.
 */

interface MapWithInsert<K, V> extends Map<K, V> {
  getOrInsert?(key: K, value: V): V;
  getOrInsertComputed?(key: K, compute: (key: K) => V): V;
}

const proto = Map.prototype as unknown as MapWithInsert<unknown, unknown>;

if (typeof proto.getOrInsert !== 'function') {
  Object.defineProperty(Map.prototype, 'getOrInsert', {
    value: function <K, V>(this: Map<K, V>, key: K, value: V): V {
      if (this.has(key)) return this.get(key) as V;
      this.set(key, value);
      return value;
    },
    writable: true,
    configurable: true,
  });
}

if (typeof proto.getOrInsertComputed !== 'function') {
  Object.defineProperty(Map.prototype, 'getOrInsertComputed', {
    value: function <K, V>(this: Map<K, V>, key: K, compute: (key: K) => V): V {
      if (this.has(key)) return this.get(key) as V;
      const value = compute(key);
      this.set(key, value);
      return value;
    },
    writable: true,
    configurable: true,
  });
}

const weakProto = WeakMap.prototype as unknown as {
  getOrInsert?: unknown;
  getOrInsertComputed?: unknown;
};

if (typeof weakProto.getOrInsertComputed !== 'function') {
  Object.defineProperty(WeakMap.prototype, 'getOrInsertComputed', {
    value: function <K extends WeakKey, V>(this: WeakMap<K, V>, key: K, compute: (key: K) => V): V {
      if (this.has(key)) return this.get(key) as V;
      const value = compute(key);
      this.set(key, value);
      return value;
    },
    writable: true,
    configurable: true,
  });
}

if (typeof weakProto.getOrInsert !== 'function') {
  Object.defineProperty(WeakMap.prototype, 'getOrInsert', {
    value: function <K extends WeakKey, V>(this: WeakMap<K, V>, key: K, value: V): V {
      if (this.has(key)) return this.get(key) as V;
      this.set(key, value);
      return value;
    },
    writable: true,
    configurable: true,
  });
}

export {};
