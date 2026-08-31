import { beforeEach, describe, expect, it } from 'vitest';
import { moveWall, removeElement } from '../domain/operations';
import { sampleFloorplan } from '../domain/sampleFloorplan';
import { floorplanStore } from './floorplanStore';

const store = floorplanStore;

beforeEach(() => {
  // reset() honours whichever template a previous test started from; pin the
  // fixture, then furnish it -- templates ship unfurnished and several tests
  // exercise selection and clearance behaviour that needs furniture.
  store.setState({ templateId: 'two-bed', templateChosen: false });
  store.getState().reset();
  store.setState({ plan: JSON.parse(JSON.stringify(sampleFloorplan)) });
});

describe('applyOperation', () => {
  it('commits the new plan and returns the violations it caused', () => {
    const result = store.getState().applyOperation((plan) => moveWall(plan, { wallId: 'living-E', distanceIn: 12, direction: 'east' }));

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.violations.some((violation) => violation.code === 'HALL_MIN_WIDTH')).toBe(true);
    expect(store.getState().plan).not.toBe(sampleFloorplan);
  });

  it('sees the edit itself, so removing a structural wall is caught', () => {
    // validate() needs the previous plan to know a wall disappeared.
    const result = store.getState().applyOperation((plan) => ({
      ok: true,
      plan: { ...plan, walls: plan.walls.filter((wall) => wall.id !== 'living-W') },
      changed: ['living-W'],
      summary: 'forced removal',
    }));

    expect(result.ok && result.violations.some((violation) => violation.code === 'LOAD_BEARING_REMOVED')).toBe(true);
  });

  it('leaves the plan and undo stack untouched when the operation fails', () => {
    const before = store.getState().plan;
    const result = store.getState().applyOperation((plan) => removeElement(plan, 'living-W'));

    expect(result.ok).toBe(false);
    expect(store.getState().plan).toBe(before);
    expect(store.getState().undoStack).toHaveLength(0);
  });
});

describe('undo', () => {
  it('restores the previous plan', () => {
    const original = store.getState().plan;
    store.getState().applyOperation((plan) => moveWall(plan, { wallId: 'living-E', distanceIn: 12, direction: 'east' }));

    expect(store.getState().undo().ok).toBe(true);
    expect(store.getState().plan).toBe(original);
  });

  it('walks back several steps at once', () => {
    const original = store.getState().plan;
    for (const distanceIn of [6, 6, 6]) {
      store.getState().applyOperation((plan) => moveWall(plan, { wallId: 'living-E', distanceIn, direction: 'east' }));
    }

    store.getState().undo(3);
    expect(store.getState().plan).toBe(original);
  });

  it('clamps an over-long undo to what is available and says so', () => {
    store.getState().applyOperation((plan) => moveWall(plan, { wallId: 'living-E', distanceIn: 6, direction: 'east' }));

    const result = store.getState().undo(10);
    expect(result.ok && result.summary).toContain('all 1');
  });

  it('reports having nothing to undo', () => {
    const result = store.getState().undo();
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toContain('Nothing to undo');
  });

  it('caps the history at 30 entries', () => {
    // Oscillate so every move stays geometrically valid and actually commits.
    for (let step = 0; step < 35; step += 1) {
      const direction = step % 2 === 0 ? 'east' : 'west';
      store.getState().applyOperation((plan) => moveWall(plan, { wallId: 'living-E', distanceIn: 6, direction }));
    }

    expect(store.getState().undoStack).toHaveLength(30);
  });
});

describe('selection', () => {
  it('records what the human picked and classifies it', () => {
    store.getState().select(['living-E']);
    expect(store.getState().selection).toEqual({ elementIds: ['living-E'], kind: 'wall' });

    store.getState().select(['sofa-1']);
    expect(store.getState().selection.kind).toBe('furniture');
  });

  it('drops ids that are not in the plan', () => {
    store.getState().select(['living-E', 'ghost']);
    expect(store.getState().selection.elementIds).toEqual(['living-E']);
  });

  it('clears', () => {
    store.getState().select(['living-E']);
    store.getState().clearSelection();
    expect(store.getState().selection).toEqual({ elementIds: [], kind: null });
  });
});

describe('variants', () => {
  it('applies a variant, banks it for undo, and clears the overlays', () => {
    const alternative = { ...sampleFloorplan, ceilingHeight: 108 };
    store.getState().setVariants([{ id: 'v1', goal: 'taller ceilings', summary: 'raise to 108in', plan: alternative }]);

    const result = store.getState().applyVariant('v1');

    expect(result.ok).toBe(true);
    expect(store.getState().plan.ceilingHeight).toBe(108);
    expect(store.getState().variants).toEqual([]);
    expect(store.getState().undoStack).toHaveLength(1);
  });

  it('lists what is on screen when the id is wrong', () => {
    store.getState().setVariants([{ id: 'v1', goal: 'g', summary: 's', plan: sampleFloorplan }]);
    const result = store.getState().applyVariant('v9');

    expect(!result.ok && result.error).toContain('v1');
  });

  it('says to propose first when nothing is on screen', () => {
    const result = store.getState().applyVariant('v1');
    expect(!result.ok && result.error).toContain('propose_variants first');
  });
});

describe('templates', () => {
  it('starts a fresh design and drops the old history', () => {
    floorplanStore.getState().applyOperation((plan) => moveWall(plan, { wallId: 'hall-E', distanceIn: 12, direction: 'east' }));
    expect(floorplanStore.getState().undoStack).toHaveLength(1);

    const result = floorplanStore.getState().loadTemplate('studio');

    expect(result.ok).toBe(true);
    expect(floorplanStore.getState().plan.rooms.map((room) => room.id)).toEqual(['main', 'bath', 'closet']);
    expect(floorplanStore.getState().undoStack).toHaveLength(0);
    expect(floorplanStore.getState().templateChosen).toBe(true);
  });

  it('lists what is available when the id is unknown', () => {
    const result = floorplanStore.getState().loadTemplate('mansion');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('studio');
      expect(result.error).toContain('two-bed');
    }
  });

  it('reset returns to the chosen template, not the default', () => {
    floorplanStore.getState().loadTemplate('studio');
    floorplanStore.getState().applyOperation((plan) => moveWall(plan, { wallId: 'main-E', distanceIn: 12, direction: 'west' }));

    floorplanStore.getState().reset();

    expect(floorplanStore.getState().plan.rooms.map((room) => room.id)).toEqual(['main', 'bath', 'closet']);
    expect(floorplanStore.getState().undoStack).toHaveLength(0);
  });
});

describe('palette arming', () => {
  it('arms one catalog item at a time and disarms on template load', () => {
    floorplanStore.getState().armCatalog('sofa');
    expect(floorplanStore.getState().armedCatalogId).toBe('sofa');

    floorplanStore.getState().armCatalog(null);
    expect(floorplanStore.getState().armedCatalogId).toBeNull();

    floorplanStore.getState().armCatalog('table');
    floorplanStore.getState().loadTemplate('one-bed');
    expect(floorplanStore.getState().armedCatalogId).toBeNull();
  });
});

