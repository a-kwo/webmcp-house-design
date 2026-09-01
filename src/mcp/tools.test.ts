import { beforeEach, describe, expect, it } from 'vitest';
import { sampleFloorplan } from '../domain/sampleFloorplan';
import { floorplanStore } from '../state/floorplanStore';
import { registerFloorplanTools } from './tools';

type Registered = {
  name: string;
  description: string;
  inputSchema: any;
  annotations?: { readOnlyHint?: boolean };
  execute: (input: unknown) => any;
};

/**
 * Mirrors the real WebMCP contract, including the parts that are easy to get
 * wrong: registerTool is async, resolves to undefined rather than a disposer,
 * throws on a duplicate name, and unregistration happens only via AbortSignal.
 */
function fakeContext() {
  const tools = new Map<string, Registered>();

  return {
    tools,
    async registerTool(tool: Registered, options?: { signal?: AbortSignal }) {
      if (tools.has(tool.name)) {
        throw new Error(`Tool "${tool.name}" is already registered.`);
      }
      if (options?.signal?.aborted) {
        return;
      }

      tools.set(tool.name, tool);
      options?.signal?.addEventListener('abort', () => {
        tools.delete(tool.name);
      });
    },
  };
}

async function setup() {
  // reset() honours whichever template a previous test started from; pin the
  // fixture so every test sees the two-bedroom sample.
  floorplanStore.setState({ templateId: 'two-bed', templateChosen: false });
  floorplanStore.getState().reset();
  // Templates ship unfurnished; these tests exercise clearance and furniture
  // behaviour, so they run against the furnished two-bed fixture.
  floorplanStore.setState({ plan: JSON.parse(JSON.stringify(sampleFloorplan)) });
  const context = fakeContext();
  const dispose = await registerFloorplanTools(context);
  const call = (name: string, input: unknown = {}) => context.tools.get(name)!.execute(input);
  return { context, dispose, call };
}

/** Lets the queued apply_variant registration settle before asserting. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('registration', () => {
  it('registers every read and write tool', async () => {
    const { context } = await setup();

    for (const name of [
      'get_layout', 'get_selection', 'compute_areas', 'validate_layout', 'get_camera',
      'list_templates', 'start_from_template',
      'add_room', 'move_wall', 'resize_room', 'add_opening', 'place_furniture',
      'move_furniture', 'update_opening', 'apply_edits', 'remove_element',
      'set_camera', 'undo', 'propose_variants',
    ]) {
      expect(context.tools.has(name)).toBe(true);
    }
  });

  it('pairs every write tool with a read tool that reflects live state', async () => {
    const { context } = await setup();
    const reads = ['get_layout', 'get_selection', 'compute_areas', 'validate_layout', 'get_camera', 'list_templates'];
    expect(reads.every((name) => context.tools.has(name))).toBe(true);
  });

  it('derives a JSON Schema for each tool from its Zod schema', async () => {
    const { context } = await setup();
    const schema = context.tools.get('move_wall')!.inputSchema;

    expect(schema.type).toBe('object');
    expect(Object.keys(schema.properties)).toEqual(['wallId', 'distanceIn', 'direction']);
    expect(schema.properties.direction.enum).toEqual(['north', 'south', 'east', 'west']);
    expect(schema.required).toEqual(['wallId', 'distanceIn', 'direction']);
  });

  it('marks read tools side-effect free and write tools not', async () => {
    const { context } = await setup();

    for (const name of ['get_layout', 'get_selection', 'compute_areas', 'validate_layout', 'get_camera']) {
      expect(context.tools.get(name)!.annotations?.readOnlyHint).toBe(true);
    }

    for (const name of ['move_wall', 'remove_element', 'undo']) {
      expect(context.tools.get(name)!.annotations?.readOnlyHint).toBe(false);
    }
  });

  it('unregisters everything on dispose', async () => {
    const { context, dispose } = await setup();
    expect(context.tools.size).toBeGreaterThan(0);

    dispose();
    expect(context.tools.size).toBe(0);
  });
});

describe('read tools', () => {
  it('returns a compact summary by default and the full plan on request', async () => {
    const { call } = await setup();

    const summary = call('get_layout', {});
    expect(summary.rooms[0]).toHaveProperty('areaSqFt');
    expect(summary).not.toHaveProperty('walls');

    const full = call('get_layout', { detail: 'full' });
    expect(full.walls.length).toBeGreaterThan(0);
  });

  it('reports the human\'s live selection, which is the WebMCP argument', async () => {
    const { call } = await setup();
    expect(call('get_selection').selected).toBe(false);

    floorplanStore.getState().select(['living-E']);
    const selection = call('get_selection');

    expect(selection.selected).toBe(true);
    expect(selection.elements[0]).toMatchObject({ kind: 'wall', id: 'living-E' });
    expect(selection.elements[0].bordersRooms).toContain('Living Room');
  });

  it('names both rooms a shared partition separates', async () => {
    const { call } = await setup();

    // hall-E is one wall referenced by both rooms, so the agent has to be told
    // that moving it resizes the hallway as well as Bedroom 2.
    floorplanStore.getState().select(['hall-E']);

    expect(call('get_selection').elements[0].bordersRooms.sort()).toEqual(['Bedroom 2', 'Hallway']);
  });

  it('gives the summary enough to place furniture without the full dump', async () => {
    const { call } = await setup();
    const bed1 = call('get_layout').rooms.find((room: { id: string }) => room.id === 'bed1');

    expect(bed1.boundsIn).toEqual({ minX: 0, minY: 180, maxX: 132, maxY: 300 });
  });

  it('computes areas and a total', async () => {
    const { call } = await setup();
    const result = call('compute_areas', { roomIds: ['living', 'kitchen'] });

    expect(result.rooms).toHaveLength(2);
    expect(result.totalSqFt).toBe(result.rooms[0].areaSqFt + result.rooms[1].areaSqFt);
  });

  it('returns violations with human messages', async () => {
    const { call } = await setup();
    const { violations } = call('validate_layout');

    expect(violations.length).toBeGreaterThan(0);
    expect(violations[0].message).toMatch(/[a-z]/);
  });
});

describe('templates over the wire', () => {
  it('lists the templates with the current one marked', async () => {
    const { call } = await setup();
    const result = call('list_templates');

    expect(result.current).toBe('two-bed');
    expect(result.templates.map((template: { id: string }) => template.id)).toContain('studio');
    expect(result.templates[0].rooms.length).toBeGreaterThan(0);
  });

  it('starts a fresh design and reports its violations', async () => {
    const { call } = await setup();
    const result = call('start_from_template', { templateId: 'studio' });

    expect(result.ok).toBe(true);
    expect(result.summary).toContain('Studio');
    expect(result.violations).toEqual([]);
    expect(call('get_layout').rooms.map((room: { id: string }) => room.id)).toEqual(['main', 'bath', 'closet']);
    expect(call('undo').ok).toBe(false);
  });

  it('names the available ids when the template is unknown', async () => {
    const { call } = await setup();
    const result = call('start_from_template', { templateId: 'castle' });

    expect(result.ok).toBe(false);
    expect(result.error).toContain('one-bed');
  });
});

describe('write tools', () => {
  it('returns the violations its own edit caused, without a second call', async () => {
    const { call } = await setup();
    const result = call('move_wall', { wallId: 'living-E', distanceIn: 12, direction: 'east' });

    expect(result.ok).toBe(true);
    expect(result.summary).toContain('Living Room');
    expect(result.violations.some((violation: any) => violation.code === 'HALL_MIN_WIDTH')).toBe(true);
  });

  it('returns an instructive error rather than throwing', async () => {
    const { call } = await setup();
    const result = call('remove_element', { elementId: 'living-W' });

    expect(result.ok).toBe(false);
    expect(result.error).toContain('add_opening');
  });

  it('rejects malformed input against the schema', async () => {
    const { call } = await setup();
    const result = call('move_wall', { wallId: 'living-E', distanceIn: 12, direction: 'sideways' });

    expect(result.ok).toBe(false);
    expect(result.error).toContain('Invalid input for move_wall');
  });

  it('carries a colour through to the placed piece', async () => {
    // The operation always supported colour; the schema silently stripped it,
    // so an agent asking for a navy sofa got the default and no error.
    const { call } = await setup();
    const result = call('place_furniture', {
      roomId: 'living', catalogId: 'sofa', footprint: { w: 84, d: 36 },
      position: { x: 60, y: 120 }, color: '#46536b',
    });

    expect(result.ok).toBe(true);
    const layout = call('get_layout', { detail: 'full' });
    expect(layout.furniture.find((item: { id: string }) => item.id === result.changed[0]).color).toBe('#46536b');
  });

  it('moves furniture and reports the rooms involved', async () => {
    const { call } = await setup();
    const result = call('move_furniture', { furnitureId: 'sofa-1', position: { x: 320, y: 180 } });

    expect(result.ok).toBe(true);
    expect(result.summary).toContain('into Bedroom 2');

    const layout = call('get_layout', { detail: 'full' });
    expect(layout.furniture.find((item: { id: string }) => item.id === 'sofa-1').roomId).toBe('bed2');
  });

  it('fixes the demo violation in one update_opening call', async () => {
    const { call } = await setup();
    const result = call('update_opening', { openingId: 'hall-bath', widthIn: 32 });

    expect(result.ok).toBe(true);
    expect(result.violations.some((violation: { code: string }) => violation.code === 'DOOR_MIN_WIDTH')).toBe(false);
  });

  it('furnishes a room in one apply_edits round trip', async () => {
    const { call } = await setup();
    const result = call('apply_edits', {
      edits: [
        { action: 'place_furniture', roomId: 'living', catalogId: 'table', footprint: { w: 48, d: 30 }, position: { x: 150, y: 60 } },
        { action: 'place_furniture', roomId: 'living', catalogId: 'chair', footprint: { w: 22, d: 22 }, position: { x: 150, y: 108 } },
        { action: 'update_opening', openingId: 'hall-bath', widthIn: 36 },
      ],
    });

    expect(result.ok).toBe(true);
    expect(result.applied).toBe(3);
    expect(result.violations.some((violation: { code: string }) => violation.code === 'DOOR_MIN_WIDTH')).toBe(false);
  });

  it('keeps going past a failed edit and reports it in place', async () => {
    const { call } = await setup();
    const result = call('apply_edits', {
      edits: [
        { action: 'place_furniture', roomId: 'nowhere', catalogId: 'chair', footprint: { w: 22, d: 22 } },
        { action: 'teleport', target: 'moon' },
        { action: 'update_opening', openingId: 'hall-bath', widthIn: 36 },
      ],
    });

    expect(result.ok).toBe(false);
    expect(result.applied).toBe(1);
    expect(result.results[0].error).toContain('No room');
    expect(result.results[1].error).toContain('Unknown action');
    expect(result.results[2].ok).toBe(true);
  });

  it('undoes back to the starting plan', async () => {
    const { call } = await setup();
    const before = call('compute_areas', {}).totalSqFt;

    call('move_wall', { wallId: 'living-E', distanceIn: 12, direction: 'east' });
    call('undo', { steps: 1 });

    expect(call('compute_areas', {}).totalSqFt).toBe(before);
  });

  it('describes the camera in plain language for first person', async () => {
    const { call } = await setup();
    call('set_camera', { mode: 'firstPerson', targetRoomId: 'kitchen' });

    expect(call('get_camera').description).toContain('Standing in Kitchen');
  });
});

describe('dynamic registration', () => {
  it('only exposes apply_variant while variants are on screen', async () => {
    const { context, call } = await setup();
    expect(context.tools.has('apply_variant')).toBe(false);

    call('propose_variants', {
      goal: 'a wider hallway',
      variants: [{ summary: 'Take 6in from the living room', edits: [{ wallId: 'living-E', distanceIn: 6, direction: 'west' }] }],
    });

    await settle();
    expect(context.tools.has('apply_variant')).toBe(true);

    call('apply_variant', { variantId: 'variant-1' });
    await settle();
    expect(context.tools.has('apply_variant')).toBe(false);
  });

  it('does not double-register apply_variant when variants change twice', async () => {
    const { context, call } = await setup();

    for (const summary of ['first', 'second']) {
      call('propose_variants', {
        goal: 'a wider hallway',
        variants: [{ summary, edits: [{ wallId: 'living-E', distanceIn: 6, direction: 'west' }] }],
      });
    }

    // A duplicate registerTool would have thrown inside the queue by now.
    await settle();
    expect(context.tools.has('apply_variant')).toBe(true);
  });

  it('lets apply_variant return before unregistering itself', async () => {
    const { context, call } = await setup();

    call('propose_variants', {
      goal: 'a wider hallway',
      variants: [{ summary: 'Narrow the living room', edits: [{ wallId: 'living-E', distanceIn: 6, direction: 'west' }] }],
    });
    await settle();

    const result = call('apply_variant', { variantId: 'variant-1' });

    // Unregistration must not happen inside apply_variant's own execution:
    // before Chrome 153 that aborts the in-flight call, so the edit lands but
    // the agent sees an error and may retry it.
    expect(result.ok).toBe(true);
    expect(context.tools.has('apply_variant')).toBe(true);

    await settle();
    expect(context.tools.has('apply_variant')).toBe(false);
  });

  it('reports variant ids and how many violations each would carry', async () => {
    const { call } = await setup();
    const result = call('propose_variants', {
      goal: 'a wider hallway',
      variants: [
        { summary: 'Narrow the living room', edits: [{ wallId: 'living-E', distanceIn: 6, direction: 'west' }] },
        { summary: 'Narrow it a lot', edits: [{ wallId: 'living-E', distanceIn: 24, direction: 'west' }] },
      ],
    });

    expect(result.ok).toBe(true);
    expect(result.variants.map((variant: any) => variant.id)).toEqual(['variant-1', 'variant-2']);
    expect(typeof result.variants[0].violations).toBe('number');
  });

  it('rejects variants built on invalid edits', async () => {
    const { call } = await setup();
    const result = call('propose_variants', {
      goal: 'impossible',
      variants: [{ summary: 'bad', edits: [{ wallId: 'ghost', distanceIn: 6, direction: 'east' }] }],
    });

    expect(result.ok).toBe(false);
    expect(result.error).toContain('get_layout');
  });
});
