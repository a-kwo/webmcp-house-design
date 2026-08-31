import { createStore } from 'zustand/vanilla';
import { useStore } from 'zustand';
import type { OperationResult } from '../domain/operations';
import { DEFAULT_TEMPLATE_ID, TEMPLATES, buildTemplate, templateById } from '../domain/templates';
import type { Floorplan, Violation } from '../domain/types';
import { validate } from '../domain/validate';

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
  /** Palette item armed for placement, with any chosen finish. */
  armed: { catalogId: string; color?: string } | null;

  applyOperation: (operation: (plan: Floorplan) => OperationResult) => ToolEnvelope;
  loadTemplate: (templateId: string) => ToolEnvelope;
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

export const floorplanStore = createStore<FloorplanState>()((set, get) => ({
  plan: buildTemplate(DEFAULT_TEMPLATE_ID),
  selection: { elementIds: [], kind: null },
  camera: { mode: 'iso', targetRoomId: null, description: 'Looking down at the whole plan from the south-east.' },
  undoStack: [],
  variants: [],
  templateId: DEFAULT_TEMPLATE_ID,
  templateChosen: false,
  armed: null,

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
    set({
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
      summary: `Started from the ${template.name} template: ${template.description}`,
    };
  },

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
