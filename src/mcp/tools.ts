import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { computeRoomSummaries, roomDimensions, roomPolygon, boundingBox } from '../domain/geometry';
import { addOpening, addRoom, moveWall, placeFurniture, removeElement, resizeRoom } from '../domain/operations';
import type { Floorplan } from '../domain/types';
import { validate } from '../domain/validate';
import type { CameraMode, FloorplanState, ToolEnvelope, Variant } from '../state/floorplanStore';
import { floorplanStore } from '../state/floorplanStore';

/**
 * The subset of the WebMCP page API this app uses.
 *
 * Two things about this API are easy to get wrong and both bite at runtime:
 * `registerTool` resolves to undefined rather than handing back a disposer, and
 * there is no `unregisterTool` -- unregistration is driven by an AbortSignal
 * passed in the options argument. It also throws if a tool of the same name is
 * already registered.
 */
type ToolAnnotations = {
  readOnlyHint?: boolean;
  untrustedContentHint?: boolean;
};

type ToolDefinition = {
  name: string;
  description: string;
  inputSchema: unknown;
  annotations?: ToolAnnotations;
  execute: (input: unknown, options?: { signal?: AbortSignal }) => Promise<unknown> | unknown;
};

type RegisterToolOptions = { signal?: AbortSignal };

type ModelContext = {
  registerTool: (tool: ToolDefinition, options?: RegisterToolOptions) => Promise<void>;
};

declare global {
  interface Document {
    modelContext?: ModelContext;
  }
  interface Navigator {
    modelContext?: ModelContext;
  }
}

/**
 * `document.modelContext` is the current location; `navigator.modelContext` is
 * the deprecated alias kept through Chromium 150. Prefer the former, accept
 * either, and return undefined outside a WebMCP browser.
 */
export function resolveModelContext(): ModelContext | undefined {
  if (typeof document !== 'undefined' && document.modelContext) {
    return document.modelContext;
  }
  if (typeof navigator !== 'undefined' && navigator.modelContext) {
    return navigator.modelContext;
  }
  return undefined;
}

const directionSchema = z.enum(['north', 'south', 'east', 'west']);
const roomTypeSchema = z.enum([
  'bedroom', 'bathroom', 'kitchen', 'living', 'dining', 'hallway', 'closet', 'utility', 'garage',
]);

const schemas = {
  get_layout: z.object({
    detail: z.enum(['summary', 'full']).default('summary')
      .describe('summary returns rooms, areas and adjacency only; full returns every wall, opening and furniture item.'),
  }),
  get_selection: z.object({}),
  compute_areas: z.object({
    roomIds: z.array(z.string()).optional().describe('Omit to measure every room.'),
  }),
  validate_layout: z.object({}),
  get_camera: z.object({}),

  add_room: z.object({
    name: z.string().describe('Human-facing name, e.g. "Guest Bedroom".'),
    type: roomTypeSchema,
    widthIn: z.number().describe('East-west size in inches; snapped to 6in.'),
    depthIn: z.number().describe('North-south size in inches; snapped to 6in.'),
    attachTo: z.object({ roomId: z.string(), side: directionSchema }).optional()
      .describe('Place the room against an existing one, sharing the wall where they line up.'),
  }),
  move_wall: z.object({
    wallId: z.string(),
    distanceIn: z.number().describe('Inches to move, snapped to the 6in grid.'),
    direction: directionSchema.describe('Must be perpendicular to the wall.'),
  }),
  resize_room: z.object({
    roomId: z.string(),
    widthIn: z.number().optional(),
    depthIn: z.number().optional(),
  }),
  add_opening: z.object({
    wallId: z.string(),
    kind: z.enum(['door', 'window', 'archway']),
    offsetIn: z.number().describe('Inches along the wall from its start point.'),
    widthIn: z.number(),
    swing: z.enum(['in-left', 'in-right', 'out-left', 'out-right', 'sliding', 'none']).optional(),
  }),
  place_furniture: z.object({
    roomId: z.string(),
    catalogId: z.string().describe('Catalog key, e.g. "queen-bed", "sofa", "toilet".'),
    footprint: z.object({ w: z.number(), d: z.number() }).describe('Plan footprint in inches.'),
    position: z.object({ x: z.number(), y: z.number() }).optional()
      .describe('Omit to auto-place against the most sensible wall.'),
    rotation: z.number().optional().describe('Degrees; 0 faces the bottom of the plan.'),
    clearanceFrontIn: z.number().optional().describe('Approach space required in front of the piece.'),
  }),
  remove_element: z.object({
    elementId: z.string().describe('A wall, room, opening or furniture id.'),
  }),
  set_camera: z.object({
    mode: z.enum(['top', 'iso', 'firstPerson']),
    targetRoomId: z.string().optional(),
    description: z.string().optional(),
  }),
  undo: z.object({
    steps: z.number().int().positive().default(1),
  }),
  propose_variants: z.object({
    goal: z.string().describe('What the alternatives should optimise for.'),
    variants: z.array(z.object({
      summary: z.string().describe('One line the human will read on the overlay.'),
      edits: z.array(z.object({
        wallId: z.string(),
        distanceIn: z.number(),
        direction: directionSchema,
      })).describe('Wall moves that define this alternative.'),
    })).min(1).max(3),
  }),
  apply_variant: z.object({ variantId: z.string() }),
};

/**
 * JSON Schema is derived from the Zod schemas once, at module load, so the
 * declaration the agent sees and the validation the tool runs cannot drift.
 */
// zod 3.25's inference blows the instantiation-depth limit when the converter's
// generic is applied across all 15 schemas, so the generic is erased here. The
// output is opaque JSON Schema either way.
const toJsonSchema = zodToJsonSchema as unknown as (schema: z.ZodTypeAny) => Record<string, unknown>;

const jsonSchemas: Record<string, unknown> = Object.fromEntries(
  (Object.entries(schemas) as [string, z.ZodTypeAny][]).map(([name, schema]) => [name, toJsonSchema(schema)]),
);

function envelope(result: ToolEnvelope): ToolEnvelope {
  return result;
}

function summarise(plan: Floorplan) {
  return computeRoomSummaries(plan).map((room) => ({
    id: room.id,
    name: room.name,
    type: room.type,
    areaSqFt: Math.round(room.areaSqFt),
    adjacentRoomIds: room.adjacentRoomIds,
    ...(room.marginAboveMinimumSqFt === null
      ? {}
      : { marginAboveMinimumSqFt: Math.round(room.marginAboveMinimumSqFt) }),
  }));
}

/** Describes the selection in the terms the agent needs to act on it. */
function describeSelection(state: FloorplanState) {
  const { plan, selection } = state;

  if (selection.elementIds.length === 0) {
    return { selected: false, message: 'The human has nothing selected right now.' };
  }

  const details = selection.elementIds.map((id) => {
    const wall = plan.walls.find((candidate) => candidate.id === id);
    if (wall) {
      const rooms = plan.rooms.filter((room) => room.wallIds.includes(id));
      return {
        id,
        kind: 'wall' as const,
        lengthIn: Math.round(Math.hypot(wall.end.x - wall.start.x, wall.end.y - wall.start.y)),
        exterior: wall.exterior,
        loadBearing: wall.loadBearing,
        bordersRooms: rooms.map((room) => room.name),
      };
    }

    const room = plan.rooms.find((candidate) => candidate.id === id);
    if (room) {
      const dimensions = roomDimensions(plan, room);
      return {
        id,
        kind: 'room' as const,
        name: room.name,
        type: room.type,
        widthIn: Math.round(dimensions.width),
        depthIn: Math.round(dimensions.depth),
      };
    }

    const opening = plan.openings.find((candidate) => candidate.id === id);
    if (opening) {
      return { id, kind: 'opening' as const, openingKind: opening.kind, widthIn: opening.width, connects: opening.connects };
    }

    const item = plan.furniture.find((candidate) => candidate.id === id);
    return item
      ? { id, kind: 'furniture' as const, catalogId: item.catalogId, roomId: item.roomId, rotation: item.rotation }
      : { id, kind: 'unknown' as const };
  });

  return { selected: true, kind: selection.kind, elements: details };
}

function buildVariants(plan: Floorplan, input: z.infer<typeof schemas.propose_variants>): Variant[] {
  return input.variants.flatMap((candidate, index) => {
    let working = plan;
    for (const edit of candidate.edits) {
      const result = moveWall(working, edit);
      if (!result.ok) {
        return [];
      }
      working = result.plan;
    }

    return [{ id: `variant-${index + 1}`, goal: input.goal, summary: candidate.summary, plan: working }];
  });
}

const READ_ONLY_TOOLS = new Set(['get_layout', 'get_selection', 'compute_areas', 'validate_layout', 'get_camera']);

/**
 * Registers the tool set against the page. Read tools and write tools are
 * always present; `apply_variant` is registered only while variants are on
 * screen, so the agent never sees an action it cannot currently take.
 *
 * Resolves to a synchronous dispose function that aborts every registration.
 */
export async function registerFloorplanTools(
  context: ModelContext = resolveModelContext()!,
  signal?: AbortSignal,
): Promise<() => void> {
  // One signal unregisters every always-on tool. It is chained to the caller's
  // signal so a React cleanup can abort synchronously, before any await
  // resolves -- otherwise StrictMode's mount/unmount/mount collides with itself
  // and the second pass dies on "Duplicate tool name".
  const controller = new AbortController();
  if (signal) {
    if (signal.aborted) {
      controller.abort();
    } else {
      signal.addEventListener('abort', () => controller.abort(), { once: true });
    }
  }

  const definitions: ToolDefinition[] = [];

  const register = <K extends keyof typeof schemas>(
    name: K,
    description: string,
    execute: (input: z.infer<(typeof schemas)[K]>) => unknown,
  ) => {
    const schema = schemas[name];

    definitions.push(
      {
        name,
        description,
        inputSchema: jsonSchemas[name],
        // Marking reads as side-effect free keeps them out of the agent's
        // confirmation flow, which matters for a live demo.
        annotations: { readOnlyHint: READ_ONLY_TOOLS.has(name) },
        execute: (raw: unknown) => {
          const parsed = schema.safeParse(raw ?? {});
          if (!parsed.success) {
            const issue = parsed.error.issues[0];
            return { ok: false, error: `Invalid input for ${name}: ${issue.path.join('.') || 'input'} ${issue.message}.` };
          }
          return execute(parsed.data as z.infer<(typeof schemas)[K]>);
        },
      },
    );
  };

  const state = () => floorplanStore.getState();

  // ---- read tools: these reflect live UI state, which is what makes this WebMCP.
  register('get_layout', 'Read the current floorplan. Defaults to a compact summary of rooms, areas and adjacency.', (input) => {
    const plan = state().plan;
    return input.detail === 'full'
      ? { units: plan.units, ceilingHeight: plan.ceilingHeight, walls: plan.walls, rooms: plan.rooms, openings: plan.openings, furniture: plan.furniture }
      : { units: plan.units, ceilingHeight: plan.ceilingHeight, rooms: summarise(plan) };
  });

  register('get_selection', 'Read what the human currently has selected in the 3D scene.', () => describeSelection(state()));

  register('compute_areas', 'Area per room, the total conditioned area, and each room\'s margin above its minimum.', (input) => {
    const plan = state().plan;
    const rooms = summarise(plan).filter((room) => !input.roomIds || input.roomIds.includes(room.id));
    return { rooms, totalSqFt: rooms.reduce((sum, room) => sum + room.areaSqFt, 0) };
  });

  register('validate_layout', 'Check the plan against the simplified residential constraints and explain what breaks.', () => ({
    violations: validate(state().plan),
  }));

  register('get_camera', 'Where the camera is and what it is looking at, in plain language.', () => state().camera);

  // ---- write tools: each returns the violations its own edit caused.
  register('add_room', 'Add a room, optionally attached to an existing one so they share a wall.', (input) =>
    envelope(state().applyOperation((plan) => addRoom(plan, input))));

  register('move_wall', 'Move a wall perpendicular to itself, resizing every room that shares it.', (input) =>
    envelope(state().applyOperation((plan) => moveWall(plan, input))));

  register('resize_room', 'Set a room\'s width and/or depth. Convenience wrapper over move_wall.', (input) =>
    envelope(state().applyOperation((plan) => resizeRoom(plan, input))));

  register('add_opening', 'Cut a door, window or archway into a wall.', (input) =>
    envelope(state().applyOperation((plan) => addOpening(plan, input))));

  register('place_furniture', 'Place a catalog item in a room; omit position to auto-place against a wall.', (input) =>
    envelope(state().applyOperation((plan) => placeFurniture(plan, input))));

  register('remove_element', 'Remove a wall, room, opening or furniture item, cascading to what depends on it.', (input) =>
    envelope(state().applyOperation((plan) => removeElement(plan, input.elementId))));

  register('set_camera', 'Move the camera. firstPerson with a target room walks the human through that space.', (input) => {
    state().setCamera({
      mode: input.mode as CameraMode,
      targetRoomId: input.targetRoomId ?? null,
      description: input.description ?? describeCamera(state().plan, input.mode, input.targetRoomId),
    });
    return { ok: true, camera: state().camera };
  });

  register('undo', 'Step the plan back through the edit history.', (input) => envelope(state().undo(input.steps)));

  register('propose_variants', 'Offer 2-3 alternative layouts as ghosted overlays for the human to choose between.', (input) => {
    const variants = buildVariants(state().plan, input);

    if (variants.length === 0) {
      return { ok: false, error: 'None of the proposed variants produced a valid layout; check the wall ids and distances against get_layout.' };
    }

    state().setVariants(variants);
    syncVariantTools();

    return {
      ok: true,
      goal: input.goal,
      variants: variants.map((variant) => ({
        id: variant.id,
        summary: variant.summary,
        violations: validate(variant.plan, state().plan).length,
      })),
    };
  });

  // `apply_variant` exists only while there is something to apply.
  let variantController: AbortController | null = null;
  // registerTool throws on a duplicate name, and the store can change again
  // before an in-flight registration resolves, so every transition is queued.
  let variantQueue: Promise<void> = Promise.resolve();

  function syncVariantTools(): void {
    variantQueue = variantQueue
      // Yield to a macrotask first. `apply_variant`'s own execute triggers this
      // sync, and before Chrome 153 aborting a tool's signal during its own
      // in-flight execution kills that execution -- the mutation lands but the
      // agent receives an error and may retry it. Deferring lets the call
      // return before its tool is unregistered.
      .then(() => new Promise<void>((resolve) => { setTimeout(resolve, 0); }))
      .then(async () => {
      // A torn-down registration must never touch the page again, even if a
      // store subscription outlives it for a tick.
      if (controller.signal.aborted) {
        return;
      }

      const showing = floorplanStore.getState().variants.length > 0;
      const registered = variantController !== null;

      if (showing === registered) {
        return;
      }

      if (!showing) {
        variantController?.abort();
        variantController = null;
        return;
      }

      const next = new AbortController();
      variantController = next;

      await context.registerTool(
        {
          name: 'apply_variant',
          description: 'Commit one of the variants currently ghosted on screen.',
          inputSchema: jsonSchemas.apply_variant,
          annotations: { readOnlyHint: false },
          execute: (raw: unknown) => {
            const parsed = schemas.apply_variant.safeParse(raw ?? {});
            if (!parsed.success) {
              return { ok: false, error: 'apply_variant needs a variantId.' };
            }
            const result = state().applyVariant(parsed.data.variantId);
            syncVariantTools();
            return result;
          },
        },
        { signal: next.signal },
      );
      });
  }

  // Abandoning a half-built registration: abort what did land and subscribe to
  // nothing. Returned instead of throwing so the caller always gets a cleanup.
  const abandon = () => {
    controller.abort();
    variantController?.abort();
    variantController = null;
  };

  // Sequential, with an abort check before each, so a teardown part-way through
  // leaves nothing registered rather than half a tool set.
  try {
    for (const definition of definitions) {
      if (controller.signal.aborted) {
        return abandon;
      }
      await context.registerTool(definition, { signal: controller.signal });
    }
  } catch (error) {
    // An in-flight registerTool rejects with AbortError when the signal fires.
    // That is a teardown, not a failure.
    if (controller.signal.aborted) {
      return abandon;
    }
    abandon();
    throw error;
  }

  if (controller.signal.aborted) {
    return abandon;
  }

  // Subscribe only once registration has actually succeeded. Subscribing any
  // earlier leaks the listener when the loop above aborts, and that orphaned
  // listener goes on fighting the next mount for the `apply_variant` name.
  const unsubscribe = floorplanStore.subscribe(syncVariantTools);
  syncVariantTools();

  return () => {
    unsubscribe();
    abandon();
  };
}

export function describeCamera(plan: Floorplan, mode: string, targetRoomId?: string): string {
  const room = plan.rooms.find((candidate) => candidate.id === targetRoomId);

  if (mode === 'firstPerson' && room) {
    const box = boundingBox(roomPolygon(plan, room));
    const neighbours = computeRoomSummaries(plan).find((summary) => summary.id === room.id)?.adjacentRoomIds ?? [];
    const facing = neighbours
      .map((id) => plan.rooms.find((candidate) => candidate.id === id)?.name)
      .filter(Boolean)[0];

    return facing
      ? `Standing in ${room.name}, facing the ${facing}.`
      : `Standing in ${room.name} (${Math.round(box.maxX - box.minX)}in across).`;
  }

  if (mode === 'top') {
    return 'Looking straight down at the floorplan.';
  }

  return room ? `Angled view centred on ${room.name}.` : 'Looking down at the whole plan from the south-east.';
}

export const toolSchemas = schemas;
