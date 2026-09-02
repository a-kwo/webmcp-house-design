import { createStore } from 'zustand/vanilla';
import { useStore } from 'zustand';
import type { OperationResult } from '../domain/operations';
import { DEFAULT_TEMPLATE_ID, TEMPLATES, buildTemplate, templateById } from '../domain/templates';
import type { Floorplan, Violation } from '../domain/types';
import { validate } from '../domain/validate';
import { clearSavedDesign, loadSavedDesign, saveDesign } from './persistence';
import type { SavedDesign } from './persistence';

const UNDO_LIMIT = 30;

export type SelectionKind = 'wall' | 'room' | 'opening' | 'furniture';

export type Selection = {
  elementIds: string[];
  kind: SelectionKind | null;
};

export type CameraMode = 'top' | 'iso' | 'firstPerson';

export type Camera = {
  mode: CameraMode;
  targetRoomId: string | null;
  description: string;
};

export type Variant = {
  id: string;
  goal: string;
  summary: string;
  plan: Floorplan;
};

/**
 * The envelope every write tool returns, so the agent sees the constraint
 * consequences of its own edit without a second round trip.
 */
export type ToolEnvelope =
  | { ok: true; changed: string[]; violations: Violation[]; summary: string }
  | { ok: false; error: string };

/** One story of the design, parked while another floor is being edited. */
export type FloorRecord = {
  templateId: string;
  plan: Floorplan;
  undoStack: Floorplan[];
};

export type FloorplanState = {
  plan: Floorplan;
  selection: Selection;
  camera: Camera;
  undoStack: Floorplan[];
  variants: Variant[];
  /** Which template this design started from; reset returns to it. */
  templateId: string;
  /** False until someone -- human or agent -- picks a starting point. */
  templateChosen: boolean;
  /**
   * Every floor of the design. The ACTIVE floor's live state stays in the
   * flat fields above -- everything downstream keeps reading `plan` -- and
   * its slot here goes stale until the next switch parks it again.
   */
  floors: FloorRecord[];
  activeFloor: number;
  /** How many floors this design has; chosen first, templates second. */
  floorCount: number;
  /** False until the human picks a floor count (or an agent implies one). */
  floorCountChosen: boolean;
  /** Palette item armed for placement, with any chosen finish. */
  armed: { catalogId: string; color?: string } | null;
  /** Doors the human has clicked shut; pure scene dressing, never saved. */
  closedDoors: string[];

  applyOperation: (operation: (plan: Floorplan) => OperationResult) => ToolEnvelope;
  loadTemplate: (templateId: string) => ToolEnvelope;
  setFloorCount: (count: number) => void;
  setActiveFloor: (index: number) => ToolEnvelope;
  loadDesign: (design: SavedDesign) => void;
  newDesign: () => void;
  toggleDoor: (openingId: string) => void;
  armCatalog: (catalogId: string | null, color?: string) => void;
  select: (elementIds: string[]) => void;
  clearSelection: () => void;
  setCamera: (camera: Partial<Camera>) => void;
  setVariants: (variants: Variant[]) => void;
  applyVariant: (variantId: string) => ToolEnvelope;
  undo: (steps?: number) => ToolEnvelope;
  reset: () => void;
};

function kindOf(plan: Floorplan, elementId: string): SelectionKind | null {
  if (plan.walls.some((wall) => wall.id === elementId)) {
    return 'wall';
  }
  if (plan.rooms.some((room) => room.id === elementId)) {
    return 'room';
  }
  if (plan.openings.some((opening) => opening.id === elementId)) {
    return 'opening';
  }
  if (plan.furniture.some((item) => item.id === elementId)) {
    return 'furniture';
  }
  return null;
}

function pushUndo(stack: Floorplan[], plan: Floorplan): Floorplan[] {
  return [...stack, plan].slice(-UNDO_LIMIT);
}

// A design saved by a previous visit resumes exactly where it left off; the
// picker only shows for a genuinely fresh start.
const restored = loadSavedDesign();

export const floorplanStore = createStore<FloorplanState>()((set, get) => ({
  plan: restored?.plan ?? buildTemplate(DEFAULT_TEMPLATE_ID),
  selection: { elementIds: [], kind: null },
  camera: { mode: 'iso', targetRoomId: null, description: 'Looking down at the whole plan from the south-east.' },
  undoStack: restored?.undoStack ?? [],
  variants: [],
  templateId: restored?.templateId ?? DEFAULT_TEMPLATE_ID,
  templateChosen: restored !== null,
  floors: restored?.floors ?? [],
  activeFloor: restored?.activeFloor ?? 0,
  floorCount: restored?.floorCount ?? 1,
  floorCountChosen: restored !== null,
  armed: null,
  closedDoors: [],

  applyOperation: (operation) => {
    const previous = get().plan;
    const result = operation(previous);

    if (!result.ok) {
      return { ok: false, error: result.error };
    }

    // Passing the previous plan lets the structural rule see the edit itself.
    const violations = validate(result.plan, previous);

    set((state) => ({
      plan: result.plan,
      undoStack: pushUndo(state.undoStack, previous),
    }));

    return { ok: true, changed: result.changed, violations, summary: result.summary };
  },

  loadTemplate: (templateId) => {
    const template = templateById(templateId);

    if (!template) {
      const available = TEMPLATES.map((candidate) => candidate.id).join(', ');
      return { ok: false, error: `No template "${templateId}". Available: ${available}.` };
    }

    // A template is a fresh start, not an edit: the history of the previous
    // design would make undo step "back" into a different house.
    const plan = buildTemplate(templateId);
    const record: FloorRecord = { templateId, plan, undoStack: [] };
    const state = get();

    // Setting up a design: each call claims the next floor, and the picker
    // stays up until every floor has its shell. Only when the last floor is
    // chosen does floor 1 land in the editor.
    if (!state.templateChosen) {
      const floors = [...state.floors, record];

      if (floors.length < state.floorCount) {
        set({ floors, floorCountChosen: true });
        return {
          ok: true,
          changed: [],
          violations: [],
          summary: `Floor ${floors.length} of ${state.floorCount} will start from the ${template.name} template. Choose a template for floor ${floors.length + 1}.`,
        };
      }

      const first = floors[0];
      set({
        floors,
        activeFloor: 0,
        plan: first.plan,
        templateId: first.templateId,
        templateChosen: true,
        floorCountChosen: true,
        undoStack: [],
        variants: [],
        selection: { elementIds: [], kind: null },
        armed: null,
      });

      return {
        ok: true,
        changed: first.plan.rooms.map((room) => room.id),
        violations: validate(first.plan),
        summary: state.floorCount > 1
          ? `All ${state.floorCount} floors are set; now editing floor 1 (${templateById(first.templateId)!.name}). Switch floors to edit the others.`
          : `Started from the ${template.name} template: ${template.description}`,
      };
    }

    // Design already under way: restart just the active floor from the
    // template, leaving the other floors untouched.
    set({
      floors: state.floors.length > 0
        ? state.floors.map((parked, index) => (index === state.activeFloor ? record : parked))
        : [record],
      plan,
      templateId,
      templateChosen: true,
      undoStack: [],
      variants: [],
      selection: { elementIds: [], kind: null },
      armed: null,
    });

    return {
      ok: true,
      changed: plan.rooms.map((room) => room.id),
      violations: validate(plan),
      summary: state.floorCount > 1
        ? `Restarted floor ${state.activeFloor + 1} from the ${template.name} template: ${template.description}`
        : `Started from the ${template.name} template: ${template.description}`,
    };
  },

  setFloorCount: (count) => {
    // Floors are decided before any shell is chosen; past that point the
    // design is under way and the count is settled.
    if (get().templateChosen) {
      return;
    }
    const clamped = Math.min(3, Math.max(1, Math.floor(count)));
    set({ floorCount: clamped, floors: [], activeFloor: 0, floorCountChosen: true });
  },

  setActiveFloor: (index) => {
    const state = get();

    if (!state.templateChosen) {
      return { ok: false, error: 'No design yet; choose templates for the floors first.' };
    }
    if (!Number.isInteger(index) || index < 0 || index >= state.floors.length) {
      return { ok: false, error: `No floor ${index + 1}; this design has ${state.floors.length} floor(s).` };
    }
    if (index === state.activeFloor) {
      return { ok: true, changed: [], violations: validate(state.plan), summary: `Already editing floor ${index + 1}.` };
    }

    // Park the live floor back into its slot, then unpack the requested one.
    const floors = state.floors.map((parked, slot) =>
      slot === state.activeFloor
        ? { templateId: state.templateId, plan: state.plan, undoStack: state.undoStack }
        : parked,
    );
    const next = floors[index];

    set({
      floors,
      activeFloor: index,
      plan: next.plan,
      templateId: next.templateId,
      undoStack: next.undoStack,
      variants: [],
      selection: { elementIds: [], kind: null },
      armed: null,
    });

    return {
      ok: true,
      changed: next.plan.rooms.map((room) => room.id),
      violations: validate(next.plan),
      summary: `Now editing floor ${index + 1} of ${floors.length}: ${next.plan.rooms.map((room) => room.name).join(', ')}.`,
    };
  },

  loadDesign: (design) =>
    set({
      plan: design.plan,
      templateId: design.templateId,
      templateChosen: true,
      floors: design.floors,
      activeFloor: design.activeFloor,
      floorCount: design.floorCount,
      floorCountChosen: true,
      undoStack: design.undoStack,
      variants: [],
      selection: { elementIds: [], kind: null },
      armed: null,
    }),

  newDesign: () => {
    // Deliberate discard: the autosave goes too, or a reload would resurrect
    // the design that was just thrown away.
    clearSavedDesign();
    set({
      plan: buildTemplate(DEFAULT_TEMPLATE_ID),
      templateId: DEFAULT_TEMPLATE_ID,
      templateChosen: false,
      floors: [],
      activeFloor: 0,
      floorCount: 1,
      floorCountChosen: false,
      undoStack: [],
      variants: [],
      selection: { elementIds: [], kind: null },
      armed: null,
    });
  },

  toggleDoor: (openingId) =>
    set((state) => ({
      closedDoors: state.closedDoors.includes(openingId)
        ? state.closedDoors.filter((id) => id !== openingId)
        : [...state.closedDoors, openingId],
    })),

  armCatalog: (catalogId, color) =>
    set({ armed: catalogId === null ? null : { catalogId, ...(color === undefined ? {} : { color }) } }),

  select: (elementIds) => {
    const plan = get().plan;
    const known = elementIds.filter((id) => kindOf(plan, id) !== null);
    set({ selection: { elementIds: known, kind: known.length > 0 ? kindOf(plan, known[0]) : null } });
  },

  clearSelection: () => set({ selection: { elementIds: [], kind: null } }),

  setCamera: (camera) => set((state) => ({ camera: { ...state.camera, ...camera } })),

  setVariants: (variants) => set({ variants }),

  applyVariant: (variantId) => {
    const state = get();
    const variant = state.variants.find((candidate) => candidate.id === variantId);

    if (!variant) {
      const available = state.variants.map((candidate) => candidate.id).join(', ');
      return {
        ok: false,
        error: available
          ? `No variant "${variantId}" on screen. Currently showing: ${available}.`
          : `No variants are on screen; call propose_variants first.`,
      };
    }

    const previous = state.plan;
    const violations = validate(variant.plan, previous);

    set({
      plan: variant.plan,
      undoStack: pushUndo(state.undoStack, previous),
      variants: [],
    });

    return {
      ok: true,
      changed: [variant.id],
      violations,
      summary: `Applied variant ${variant.id}: ${variant.summary}`,
    };
  },

  undo: (steps = 1) => {
    const state = get();
    const available = state.undoStack.length;

    if (available === 0) {
      return { ok: false, error: 'Nothing to undo; this is the original plan.' };
    }

    const take = Math.min(Math.max(1, Math.floor(steps)), available);
    const target = state.undoStack[available - take];
    const previous = state.plan;

    set({ plan: target, undoStack: state.undoStack.slice(0, available - take) });

    return {
      ok: true,
      changed: [],
      violations: validate(target, previous),
      summary: take === available && steps > available
        ? `Undid all ${take} available step(s); ${steps} were requested.`
        : `Undid ${take} step(s).`,
    };
  },

  reset: () =>
    set((state) => ({
      plan: buildTemplate(state.templateId),
      selection: { elementIds: [], kind: null },
      camera: { mode: 'iso', targetRoomId: null, description: 'Looking down at the whole plan from the south-east.' },
      undoStack: [],
      variants: [],
      armed: null,
    })),
}));

export function useFloorplanStore<T>(selector: (state: FloorplanState) => T): T {
  return useStore(floorplanStore, selector);
}

/**
 * The design as one saveable value. The active floor's live state is parked
 * into its slot first, so the snapshot is whole even between floor switches.
 */
export function designSnapshot(state: FloorplanState): SavedDesign {
  const live = { templateId: state.templateId, plan: state.plan, undoStack: state.undoStack };
  const floors = state.floors.length > 0
    ? state.floors.map((parked, index) => (index === state.activeFloor ? live : parked))
    : [live];

  return {
    version: 1,
    templateId: state.templateId,
    floors,
    activeFloor: state.activeFloor,
    floorCount: floors.length,
    plan: state.plan,
    undoStack: state.undoStack,
  };
}

// Autosave: every committed change writes through to this browser's storage.
// Reference checks keep selection and camera churn from spamming writes, and
// nothing is saved mid-setup -- half a picker flow is not a design.
floorplanStore.subscribe((state, previous) => {
  if (!state.templateChosen) {
    return;
  }
  if (
    state.plan === previous.plan &&
    state.floors === previous.floors &&
    state.activeFloor === previous.activeFloor &&
    state.undoStack === previous.undoStack &&
    state.templateChosen === previous.templateChosen
  ) {
    return;
  }
  saveDesign(designSnapshot(state));
});
