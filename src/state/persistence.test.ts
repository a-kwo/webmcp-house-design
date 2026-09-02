// @vitest-environment jsdom
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildTemplate } from '../domain/templates';
import {
  STORAGE_KEY,
  decodeShare,
  encodeShare,
  loadSavedDesign,
  parseSavedDesign,
  saveDesign,
} from './persistence';
import type { SavedDesign } from './persistence';

function design(): SavedDesign {
  const plan = buildTemplate('studio');
  return {
    version: 1,
    templateId: 'studio',
    floors: [{ templateId: 'studio', plan, undoStack: [buildTemplate('studio')] }],
    activeFloor: 0,
    floorCount: 1,
    plan,
    undoStack: [buildTemplate('studio')],
  };
}

// This jsdom build ships without localStorage; a Map-backed stand-in gives
// the module the same surface, which its guards already require anyway.
beforeAll(() => {
  const backing = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => backing.get(key) ?? null,
    setItem: (key: string, value: string) => void backing.set(key, String(value)),
    removeItem: (key: string) => void backing.delete(key),
    clear: () => backing.clear(),
  });
});

beforeEach(() => localStorage.clear());

describe('local save', () => {
  it('round-trips a design through storage', () => {
    saveDesign(design());

    const loaded = loadSavedDesign();
    expect(loaded).not.toBeNull();
    expect(loaded!.templateId).toBe('studio');
    expect(loaded!.plan.rooms.map((room) => room.id)).toEqual(['main', 'bath', 'closet']);
    expect(loaded!.undoStack).toHaveLength(1);
  });

  it('returns null when nothing is saved', () => {
    expect(loadSavedDesign()).toBeNull();
  });

  it('rejects storage another page or version wrote', () => {
    localStorage.setItem(STORAGE_KEY, '{"version":99,"nonsense":true}');
    expect(loadSavedDesign()).toBeNull();

    localStorage.setItem(STORAGE_KEY, 'not json at all');
    expect(loadSavedDesign()).toBeNull();
  });

  it('rejects a design whose active floor does not exist', () => {
    const broken = { ...design(), activeFloor: 4 };
    expect(parseSavedDesign(JSON.stringify(broken))).toBeNull();
  });
});

describe('share links', () => {
  it('round-trips a design through the link payload', async () => {
    const payload = await encodeShare(design());
    const decoded = await decodeShare(payload);

    expect(decoded).not.toBeNull();
    expect(decoded!.plan.rooms.map((room) => room.id)).toEqual(['main', 'bath', 'closet']);
    // Links carry the design, not the journey.
    expect(decoded!.undoStack).toEqual([]);
    expect(decoded!.floors[0].undoStack).toEqual([]);
  });

  it('shrugs off a mangled payload', async () => {
    expect(await decodeShare('zthis-is-not-deflate')).toBeNull();
    expect(await decodeShare('x????')).toBeNull();
  });
});
