/**
 * Environment diagnostics for failures we cannot reproduce.
 *
 * When reading a PDF fails, the interesting question is almost never "what is
 * in the file" — it is "what is missing in this browser". This module probes
 * the handful of platform features pdf.js actually depends on and formats the
 * result as a block the user can copy into a bug report.
 */

export interface Diagnostics {
  /** Ordered label/value pairs, ready to render or copy. */
  entries: [string, string][];
}

function yn(ok: boolean): string {
  return ok ? 'yes' : 'NO';
}

/** Can this realm construct a module Worker at all? */
function probeWorker(): { worker: boolean; moduleWorker: boolean; blobUrl: boolean } {
  let blobUrl = false;
  let worker = false;
  let moduleWorker = false;
  let url: string | null = null;
  try {
    url = URL.createObjectURL(new Blob(['self.close();'], { type: 'text/javascript' }));
    blobUrl = true;
  } catch {
    /* blob URLs unavailable */
  }
  if (url && typeof Worker === 'function') {
    try {
      new Worker(url).terminate();
      worker = true;
    } catch {
      /* classic workers unavailable */
    }
    try {
      new Worker(url, { type: 'module' }).terminate();
      moduleWorker = true;
    } catch {
      /* module workers unavailable */
    }
  }
  if (url) URL.revokeObjectURL(url);
  return { worker, moduleWorker, blobUrl };
}

/**
 * Asks a real worker whether it has the Map proposal pdf.js relies on.
 * The worker realm is the one that matters, and it is the one nobody can see.
 */
function probeWorkerRealm(timeoutMs = 2000): Promise<string> {
  return new Promise((resolve) => {
    let url: string | null = null;
    let w: Worker | null = null;
    const done = (v: string) => {
      try {
        w?.terminate();
      } catch {
        /* already gone */
      }
      if (url) URL.revokeObjectURL(url);
      resolve(v);
    };
    try {
      url = URL.createObjectURL(
        new Blob(
          [
            'self.postMessage({' +
              'map: typeof Map.prototype.getOrInsertComputed === "function",' +
              'withResolvers: typeof Promise.withResolvers === "function",' +
              'offscreen: typeof OffscreenCanvas === "function"' +
              '});',
          ],
          { type: 'text/javascript' },
        ),
      );
      w = new Worker(url, { type: 'module' });
      const timer = setTimeout(() => done('worker did not respond'), timeoutMs);
      w.onerror = () => {
        clearTimeout(timer);
        done('worker failed to start');
      };
      w.onmessage = (e: MessageEvent) => {
        clearTimeout(timer);
        const d = e.data as { map: boolean; withResolvers: boolean; offscreen: boolean };
        done(
          `Map.getOrInsertComputed=${yn(d.map)} Promise.withResolvers=${yn(
            d.withResolvers,
          )} OffscreenCanvas=${yn(d.offscreen)}`,
        );
      };
    } catch (err) {
      done(`could not start probe worker (${(err as Error)?.message ?? err})`);
    }
  });
}

function canvasWorks(): boolean {
  try {
    const c = document.createElement('canvas');
    c.width = 4;
    c.height = 4;
    return !!c.getContext('2d');
  } catch {
    return false;
  }
}

/** A short, human-readable description of the file we were given. */
export function describeFile(name: string, bytes: ArrayBuffer | null): string {
  if (!bytes) return name || '(unknown)';
  const kb = (bytes.byteLength / 1024).toFixed(1);
  let header = '';
  try {
    header = new TextDecoder('latin1').decode(new Uint8Array(bytes.slice(0, 8))).replace(/[^\x20-\x7e]/g, '.');
  } catch {
    /* unreadable header */
  }
  return `${name || '(unnamed)'} · ${kb} KB · starts "${header}"`;
}

/**
 * Builds the full report. Async because the most valuable probe — what the
 * worker realm actually supports — requires starting a worker.
 */
export async function collectDiagnostics(context: {
  phase: string;
  route: string;
  file: string;
  error: unknown;
  pdfjsVersion: string;
}): Promise<Diagnostics> {
  const err = context.error as Error | undefined;
  const caps = probeWorker();
  const workerRealm = caps.moduleWorker ? await probeWorkerRealm() : 'not tested (no module worker)';

  const entries: [string, string][] = [
    ['when', new Date().toISOString()],
    ['failed at', context.phase],
    ['load route', context.route],
    ['file', context.file],
    ['error', err ? `${err.name ?? 'Error'}: ${err.message ?? String(err)}` : String(context.error)],
  ];

  const stack = err?.stack?.split('\n').slice(0, 4).join(' ⏎ ');
  if (stack) entries.push(['stack (top)', stack]);

  entries.push(
    ['pdf.js', context.pdfjsVersion],
    ['page', typeof location !== 'undefined' ? location.href : '(no location)'],
    ['browser', typeof navigator !== 'undefined' ? navigator.userAgent : '(no navigator)'],
    [
      'main thread',
      `Worker=${yn(caps.worker)} moduleWorker=${yn(caps.moduleWorker)} blobURL=${yn(
        caps.blobUrl,
      )} canvas2d=${yn(canvasWorks())} Map.getOrInsertComputed=${yn(
        typeof (Map.prototype as { getOrInsertComputed?: unknown }).getOrInsertComputed === 'function',
      )} Promise.withResolvers=${yn(
        typeof (Promise as { withResolvers?: unknown }).withResolvers === 'function',
      )}`,
    ],
    ['worker realm', workerRealm],
  );

  return { entries };
}

/** The copyable form of a report. */
export function formatDiagnostics(d: Diagnostics): string {
  const width = Math.max(...d.entries.map(([k]) => k.length));
  return [
    'Paper Animator — diagnostic report',
    '----------------------------------',
    ...d.entries.map(([k, v]) => `${k.padEnd(width)}  ${v}`),
  ].join('\n');
}
