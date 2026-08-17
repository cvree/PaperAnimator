import type { Id } from './types';

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
let lastMs = 0;
let counter = 0;

/** Monotonic, sortable, collision-safe within a session. */
export function newId<T extends string>(prefix: T): Id<T> {
  const now = Date.now();
  if (now === lastMs) counter++;
  else {
    lastMs = now;
    counter = 0;
  }
  let ts = '';
  let n = now;
  for (let i = 0; i < 8; i++) {
    ts = ALPHABET[n % 32] + ts;
    n = Math.floor(n / 32);
  }
  let rand = '';
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  for (const b of bytes) rand += ALPHABET[b % 32];
  const c = counter.toString(32).toUpperCase().padStart(2, '0');
  return `${prefix}_${ts}${c}${rand}` as Id<T>;
}

export function shortId(id: string): string {
  const body = id.split('_')[1] ?? id;
  return body.slice(-6);
}
