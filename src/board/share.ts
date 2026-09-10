import { newId } from '@/core/id';
import type { Paper, Project } from '@/core/types';
import { DEFAULT_SETTINGS } from '@/state/store';
import { createBoard } from './board';
import type { Board, Card } from './types';

/**
 * Handing the board to somebody else.
 *
 * Two links, and the difference between them is only what the other person is
 * allowed to do when it opens: a **viewer** link opens the talk and runs it, a
 * **editor** link opens the board with the tools in reach. That is the whole
 * mental model, and it is the one everybody already has from a document they
 * have shared before.
 *
 * The board travels inside the fragment of the URL. A fragment is never sent to
 * a server — not ours, not the recipient's — so sharing here uploads nothing,
 * needs no account, survives us going away, and works with the network off once
 * the page is loaded. The cost is honest and worth stating plainly in the UI:
 * a link is a copy, not a shared document. Two people with the same editor link
 * are editing two boards, and the way back to one board is to send a new link.
 */

export type ShareRole = 'viewer' | 'editor';

export const SHARE_ROLES: ShareRole[] = ['viewer', 'editor'];

/** What each role means, in the words the share sheet uses. */
export const ROLE_COPY: Record<ShareRole, { label: string; blurb: string; verb: string }> = {
  viewer: {
    label: 'Viewer',
    blurb: 'Opens as the talk — full screen, click to advance. Nothing can be moved.',
    verb: 'can watch the talk',
  },
  editor: {
    label: 'Editor',
    blurb: 'Opens as the board, with the tools. They get their own copy to change.',
    verb: 'can edit their own copy',
  },
};

/** The fragment key each role is carried under. */
const HASH_KEY: Record<ShareRole, string> = { viewer: 'view', editor: 'edit' };

/** Roughly what a link can carry before mail clients start breaking it. */
export const SHARE_BUDGET = 900_000;

/* ============================================================================
   Assets

   Object URLs die with the tab that made them, so every image on the board is
   carried inside whatever leaves this app — a link or a published file both.
   ========================================================================== */

async function toDataUrl(url: string): Promise<string | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const blob = await res.blob();
    return await new Promise<string | null>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : null);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

function cardAssets(board: Board): string[] {
  const urls = new Set<string>();
  for (const card of board.cards) {
    if (card.kind === 'image' && card.src) urls.add(card.src);
    if (card.kind === 'table' && card.src) urls.add(card.src);
  }
  return [...urls];
}

export async function inlineAssets(
  board: Board,
  onProgress?: (stage: string, progress: number) => void,
): Promise<{ map: Map<string, string>; failed: number }> {
  const urls = cardAssets(board);
  const map = new Map<string, string>();
  let failed = 0;
  for (const [i, url] of urls.entries()) {
    onProgress?.('Packing images', urls.length ? (i + 1) / urls.length : 1);
    if (url.startsWith('data:')) {
      map.set(url, url);
      continue;
    }
    const data = await toDataUrl(url);
    if (data) map.set(url, data);
    else failed++;
  }
  return { map, failed };
}

/** The board with every image swapped for something that outlives this tab. */
export function packBoard(board: Board, assets: Map<string, string>): Board {
  return {
    ...board,
    cards: board.cards.map((card) => {
      if (card.kind === 'image' || card.kind === 'table') {
        return { ...card, src: card.src ? (assets.get(card.src) ?? null) : null };
      }
      return card;
    }),
  };
}

/* ============================================================================
   The address
   ========================================================================== */

interface SharePayload {
  v: 1;
  role: ShareRole;
  title: string;
  board: Board;
}

/** Gzip when the browser has it, base64url always, so the result is URL-safe. */
async function encodePayload(payload: SharePayload): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(payload));
  let body = bytes;
  let gzipped = false;
  if (typeof CompressionStream === 'function') {
    const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('gzip'));
    body = new Uint8Array(await new Response(stream).arrayBuffer());
    gzipped = true;
  }
  return `${gzipped ? 'z' : 'r'}.${base64Url(body)}`;
}

function base64Url(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(body: string): Uint8Array<ArrayBuffer> {
  const b64 = body.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(b64.padEnd(Math.ceil(b64.length / 4) * 4, '='));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** The address this app is being served from, without whatever link opened it. */
function appBase(): string {
  return `${location.origin}${location.pathname}${location.search}`;
}

/**
 * One share link, ready to paste. `null` when the board is too heavy to travel
 * in an address — figures are almost always the reason.
 */
export async function encodeShareLink(
  project: Project,
  assets: Map<string, string>,
  role: ShareRole,
): Promise<string | null> {
  try {
    const encoded = await encodePayload({
      v: 1,
      role,
      title: project.title,
      board: packBoard(project.board, assets),
    });
    return `${appBase()}#${HASH_KEY[role]}=${encoded}`;
  } catch {
    return null;
  }
}

export interface ShareLink {
  role: ShareRole;
  /** Null when the link would be longer than anything will carry. */
  url: string | null;
  /** How long the address is, even when it is too long to use. */
  bytes: number;
  /** Images that could not be packed and will be missing for the recipient. */
  assetsFailed: number;
}

/** Pack the board and write the link for one role. */
export async function buildShareLink(project: Project, role: ShareRole): Promise<ShareLink> {
  const { map, failed } = await inlineAssets(project.board);
  const url = await encodeShareLink(project, map, role);
  const bytes = url ? url.length : 0;
  return {
    role,
    url: url && bytes <= SHARE_BUDGET ? url : null,
    bytes,
    assetsFailed: failed,
  };
}

/* ============================================================================
   Opening one
   ========================================================================== */

export interface SharedBoardLink {
  role: ShareRole;
  title: string;
  board: Board;
}

/**
 * Which kind of link this address is, without paying to decode it. `#talk=` is
 * what published links were called before roles existed; it opens as a viewer,
 * because that is what it always did.
 */
export function shareRoleOf(hash: string): ShareRole | null {
  if (hash.startsWith('#view=')) return 'viewer';
  if (hash.startsWith('#edit=')) return 'editor';
  if (hash.startsWith('#talk=')) return 'viewer';
  return null;
}

/** The other half of {@link encodeShareLink}, used when the app opens on a link. */
export async function decodeShareLink(hash: string): Promise<SharedBoardLink | null> {
  const role = shareRoleOf(hash);
  if (!role) return null;
  const raw = hash.slice(hash.indexOf('=') + 1);
  if (!raw) return null;

  try {
    const [flag, body] = raw.split('.');
    if (!body) return null;
    const bytes = fromBase64Url(body);

    let json: string;
    if (flag === 'z' && typeof DecompressionStream === 'function') {
      const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
      json = await new Response(stream).text();
    } else {
      json = new TextDecoder().decode(bytes);
    }

    const parsed = JSON.parse(json) as Partial<SharePayload>;
    if (!parsed?.board?.cards) return null;
    return {
      /* The address decides the role, not the payload: a link that says viewer
         is a viewer link even if it was written by an older build. */
      role,
      title: typeof parsed.title === 'string' ? parsed.title : 'Shared board',
      board: normaliseBoard(parsed.board),
    };
  } catch {
    return null;
  }
}

/**
 * A board from someone else's build may be missing fields this one expects.
 * Filling them is cheaper than defending every read site, and an older link
 * should open looking plain rather than looking broken.
 */
function normaliseBoard(board: Board): Board {
  const blank = createBoard();
  return {
    ...blank,
    ...board,
    cards: (Array.isArray(board.cards) ? board.cards : []).filter(
      (c): c is Card => !!c && typeof c === 'object' && 'kind' in c,
    ),
    edges: Array.isArray(board.edges) ? board.edges : [],
    stops: Array.isArray(board.stops) ? board.stops : [],
    stopAspect:
      typeof board.stopAspect === 'number' && board.stopAspect > 0 ? board.stopAspect : 16 / 9,
  };
}

/**
 * A shared board is nobody's paper — there is no PDF behind it, and pretending
 * otherwise would put an empty reader in front of somebody who only wanted to
 * move a card. It becomes a project with no paper, which every board surface
 * already copes with, and the reader is simply not offered.
 */
export function projectFromShare(shared: SharedBoardLink): Project {
  const now = new Date().toISOString();
  const title = shared.title || 'Shared board';
  return {
    id: newId('project'),
    version: 1,
    title,
    paper: emptyPaper(title),
    settings: DEFAULT_SETTINGS,
    scenes: [],
    board: shared.board,
    style: 'broadsheet',
    createdAt: now,
    updatedAt: now,
  };
}

function emptyPaper(title: string): Paper {
  return {
    meta: {
      title,
      authors: [],
      abstract: null,
      doi: null,
      venue: null,
      year: null,
      language: 'en',
      pageCount: 0,
      isScanned: false,
    },
    pages: [],
    sections: [],
    figures: [],
    tables: [],
    statistics: [],
    references: [],
    comprehension: {
      question: null,
      method: null,
      findings: [],
      limitations: [],
      conclusions: [],
    },
    extraction: { stages: [], degradations: [], overallConfidence: 1, durationMs: 0 },
  };
}
