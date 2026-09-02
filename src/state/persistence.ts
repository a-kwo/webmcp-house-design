import type { Floorplan } from '../domain/types';

/**
 * Saving and sharing designs without a server.
 *
 * Three channels, one format:
 *  - localStorage autosave, so closing the tab and coming back resumes the
 *    design (per browser profile; nothing ever leaves the machine),
 *  - export/import as a .json file the user actually holds,
 *  - share links that carry the whole design in the URL fragment, deflated
 *    and base64url-encoded; the fragment never reaches any server.
 *
 * Everything here is guarded for environments without storage or the
 * Compression Streams API (jsdom, SSR): functions no-op or fall back to
 * uncompressed encoding rather than throw.
 */

export const STORAGE_KEY = 'webmcp-home-design:v1';

export type SavedFloor = {
  templateId: string;
  plan: Floorplan;
  undoStack: Floorplan[];
};

export type SavedDesign = {
  version: 1;
  templateId: string;
  floors: SavedFloor[];
  activeFloor: number;
  floorCount: number;
  plan: Floorplan;
  undoStack: Floorplan[];
};

function hasStorage(): boolean {
  try {
    return typeof localStorage !== 'undefined';
  } catch {
    return false;
  }
}

function looksLikePlan(candidate: unknown): candidate is Floorplan {
  const plan = candidate as Floorplan | null;
  return (
    !!plan &&
    Array.isArray(plan.rooms) &&
    Array.isArray(plan.walls) &&
    Array.isArray(plan.openings) &&
    Array.isArray(plan.furniture)
  );
}

/** Parses and structurally checks a serialized design; null over throwing,
 * because every caller holds data from outside the app -- storage that other
 * code may have written, a dropped file, a pasted link. */
export function parseSavedDesign(raw: string): SavedDesign | null {
  try {
    const design = JSON.parse(raw) as SavedDesign;
    const floorsValid =
      Array.isArray(design.floors) &&
      design.floors.length >= 1 &&
      design.floors.length <= 3 &&
      design.floors.every((floor) => looksLikePlan(floor?.plan) && Array.isArray(floor?.undoStack));

    if (
      design?.version !== 1 ||
      typeof design.templateId !== 'string' ||
      !floorsValid ||
      !Number.isInteger(design.activeFloor) ||
      design.activeFloor < 0 ||
      design.activeFloor >= design.floors.length ||
      !looksLikePlan(design.plan) ||
      !Array.isArray(design.undoStack)
    ) {
      return null;
    }

    return { ...design, floorCount: design.floors.length };
  } catch {
    return null;
  }
}

export function loadSavedDesign(): SavedDesign | null {
  if (!hasStorage()) {
    return null;
  }
  const raw = localStorage.getItem(STORAGE_KEY);
  return raw === null ? null : parseSavedDesign(raw);
}

export function saveDesign(design: SavedDesign): void {
  if (!hasStorage()) {
    return;
  }
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(design));
  } catch {
    // Quota or privacy mode: losing autosave must never break editing.
  }
}

export function clearSavedDesign(): void {
  if (!hasStorage()) {
    return;
  }
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Same as above.
  }
}

// ---- share links -----------------------------------------------------------

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(encoded: string): Uint8Array | null {
  try {
    const binary = atob(encoded.replace(/-/g, '+').replace(/_/g, '/'));
    return Uint8Array.from(binary, (char) => char.charCodeAt(0));
  } catch {
    return null;
  }
}

async function pipeBytes(bytes: Uint8Array, stream: { readable: ReadableStream; writable: WritableStream }): Promise<Uint8Array> {
  // A hand-rolled source instead of Blob.stream(): jsdom's Blob has no
  // stream(), and the ReadableStream + Response pair exists everywhere the
  // compression streams do.
  const source = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
  const piped = source.pipeThrough(stream as ReadableWritablePair<Uint8Array, Uint8Array>);
  return new Uint8Array(await new Response(piped).arrayBuffer());
}

/**
 * The design as a URL fragment payload. Undo history is dropped -- a link
 * shares the design, not the journey -- and the JSON is deflated when the
 * browser can, which cuts a multi-floor design from tens of KB to a few.
 * The payload's first letter says which encoding produced it.
 */
export async function encodeShare(design: SavedDesign): Promise<string> {
  const slim: SavedDesign = {
    ...design,
    undoStack: [],
    floors: design.floors.map((floor) => ({ ...floor, undoStack: [] })),
  };
  const json = new TextEncoder().encode(JSON.stringify(slim));

  if (typeof CompressionStream !== 'undefined') {
    const deflated = await pipeBytes(json, new CompressionStream('deflate-raw'));
    return `z${toBase64Url(deflated)}`;
  }
  return `j${toBase64Url(json)}`;
}

export async function decodeShare(payload: string): Promise<SavedDesign | null> {
  const kind = payload[0];
  const bytes = fromBase64Url(payload.slice(1));
  if (!bytes || (kind !== 'z' && kind !== 'j')) {
    return null;
  }

  try {
    const json = kind === 'z'
      ? await pipeBytes(bytes, new DecompressionStream('deflate-raw'))
      : bytes;
    return parseSavedDesign(new TextDecoder().decode(json));
  } catch {
    return null;
  }
}

const SHARE_PREFIX = '#d=';

export function shareFragment(): string | null {
  if (typeof location === 'undefined' || !location.hash.startsWith(SHARE_PREFIX)) {
    return null;
  }
  return location.hash.slice(SHARE_PREFIX.length);
}

export function shareUrl(payload: string): string {
  return `${location.origin}${location.pathname}${SHARE_PREFIX}${payload}`;
}
