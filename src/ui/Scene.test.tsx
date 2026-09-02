// @vitest-environment jsdom
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { moveFurniture, moveWall } from '../domain/operations';
import { sampleFloorplan } from '../domain/sampleFloorplan';
import { floorplanStore } from '../state/floorplanStore';
import type { Variant } from '../state/floorplanStore';
import { CameraBar, SelectionActions, VariantBar } from './Scene';

/**
 * The canvas itself needs WebGL, which jsdom has none of. These are the two
 * pieces of the viewport that are plain DOM, and they carry the actions a human
 * takes on a proposal, so they are worth covering without a renderer.
 */

function buildVariant(id: string, summary: string, distanceIn: number): Variant {
  const result = moveWall(floorplanStore.getState().plan, {
    wallId: 'hall-E',
    distanceIn,
    direction: 'east',
  });

  if (!result.ok) {
    throw new Error(result.error);
  }

  return { id, goal: 'Widen the hallway to clear 36in', summary, plan: result.plan };
}

function Harness() {
  const [previewId, setPreviewId] = useState<string | null>('variant-1');
  return <VariantBar previewId={previewId} onPreview={setPreviewId} />;
}

beforeEach(() => {
  floorplanStore.setState({ templateId: 'two-bed', templateChosen: false });
  floorplanStore.getState().reset();
  // Templates ship unfurnished; these tests exercise clearance and furniture
  // behaviour, so they run against the furnished two-bed fixture.
  floorplanStore.setState({ plan: JSON.parse(JSON.stringify(sampleFloorplan)) });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('camera bar', () => {
  it('moves the camera and says where it is in plain language', () => {
    render(<CameraBar />);

    fireEvent.click(screen.getByText('Top'));

    expect(floorplanStore.getState().camera.mode).toBe('top');
    expect(screen.getByText(/Looking straight down/)).toBeDefined();
  });

  it('walks through whichever room the human has selected', () => {
    floorplanStore.getState().select(['bed2']);
    render(<CameraBar />);

    fireEvent.click(screen.getByText('Walk through'));
    const { camera } = floorplanStore.getState();

    expect(camera.mode).toBe('firstPerson');
    expect(camera.targetRoomId).toBe('bed2');
    expect(camera.description).toContain('Bedroom 2');
  });

  it('keeps the target when the selection is not a room', () => {
    floorplanStore.getState().setCamera({ mode: 'iso', targetRoomId: 'bath' });
    floorplanStore.getState().select(['bed-1']);
    render(<CameraBar />);

    fireEvent.click(screen.getByText('Walk through'));

    expect(floorplanStore.getState().camera.targetRoomId).toBe('bath');
  });
});

describe('variant bar', () => {
  it('stays out of the way when nothing has been proposed', () => {
    const { container } = render(<Harness />);

    expect(container.querySelector('.variant-bar')).toBeNull();
  });

  it('shows the goal, each summary, and what each one would break', () => {
    floorplanStore.getState().setVariants([
      buildVariant('variant-1', 'Take 6in from Bedroom 2.', 12),
      buildVariant('variant-2', 'Take 12in from Bedroom 2.', 24),
    ]);

    render(<Harness />);

    expect(screen.getByText('Widen the hallway to clear 36in')).toBeDefined();
    expect(screen.getByText('Take 6in from Bedroom 2.')).toBeDefined();
    expect(screen.getAllByText(/issues?$/).length).toBe(2);
  });

  it('commits the variant behind the button that was pressed', () => {
    floorplanStore.getState().setVariants([
      buildVariant('variant-1', 'Take 6in from Bedroom 2.', 12),
      buildVariant('variant-2', 'Take 12in from Bedroom 2.', 24),
    ]);
    const before = floorplanStore.getState().plan;

    render(<Harness />);
    fireEvent.click(screen.getAllByText('Apply')[1]);

    const after = floorplanStore.getState();
    expect(after.variants).toHaveLength(0);
    expect(after.plan).not.toEqual(before);
    // variant-2 moved the wall twice as far, so the hallway is 24in wider.
    expect(after.undoStack).toHaveLength(1);
  });

  it('previews the card the human points at', () => {
    floorplanStore.getState().setVariants([
      buildVariant('variant-1', 'Take 6in from Bedroom 2.', 12),
      buildVariant('variant-2', 'Take 12in from Bedroom 2.', 24),
    ]);

    const { container } = render(<Harness />);
    fireEvent.mouseEnter(screen.getByText('Take 12in from Bedroom 2.'));

    const active = container.querySelectorAll('.variant-card.active');
    expect(active).toHaveLength(1);
    expect(active[0].textContent).toContain('Take 12in from Bedroom 2.');
  });
});

describe('selection actions', () => {
  it('stays hidden unless furniture is selected', () => {
    floorplanStore.getState().select(['living']);
    const { container } = render(<SelectionActions />);

    expect(container.querySelector('.selection-actions')).toBeNull();
  });

  it('turns the selected piece a quarter turn, like the agent would', () => {
    floorplanStore.getState().select(['sofa-1']);
    render(<SelectionActions />);

    fireEvent.click(screen.getByText(/Rotate/));

    const sofa = floorplanStore.getState().plan.furniture.find((item) => item.id === 'sofa-1')!;
    expect(sofa.rotation).toBe(90);
    expect(floorplanStore.getState().undoStack).toHaveLength(1);
  });

  it('rotates on the R key too', () => {
    floorplanStore.getState().select(['sofa-1']);
    render(<SelectionActions />);

    fireEvent.keyDown(window, { key: 'r' });

    const sofa = floorplanStore.getState().plan.furniture.find((item) => item.id === 'sofa-1')!;
    expect(sofa.rotation).toBe(90);
  });

  it('resizes the piece through the footprint steppers', () => {
    floorplanStore.getState().select(['sofa-1']);
    render(<SelectionActions />);

    fireEvent.click(screen.getByTitle('Deeper'));

    const sofa = floorplanStore.getState().plan.furniture.find((item) => item.id === 'sofa-1')!;
    expect(sofa.footprint).toEqual({ w: 84, d: 42 });
    // One undo away, like any other edit.
    expect(floorplanStore.getState().undoStack.length).toBeGreaterThan(0);
  });

  it('removes the piece behind the red cross and clears the selection', () => {
    floorplanStore.getState().select(['sofa-1']);
    render(<SelectionActions />);

    fireEvent.click(screen.getByLabelText('Remove sofa'));

    expect(floorplanStore.getState().plan.furniture.some((item) => item.id === 'sofa-1')).toBe(false);
    expect(floorplanStore.getState().selection.elementIds).toEqual([]);
    // One undo away, like any other edit.
    expect(floorplanStore.getState().undoStack).toHaveLength(1);
  });

  it('removes on the Delete key too', () => {
    floorplanStore.getState().select(['bed-2']);
    render(<SelectionActions />);

    fireEvent.keyDown(window, { key: 'Delete' });

    expect(floorplanStore.getState().plan.furniture.some((item) => item.id === 'bed-2')).toBe(false);
  });

  it('shows the refusal when a turn does not fit', () => {
    // Park the bed against Bedroom 1's west wall; turned 90deg its 80in side
    // would poke through it.
    floorplanStore.getState().applyOperation((plan) =>
      moveFurniture(plan, { furnitureId: 'bed-1', position: { x: 36, y: 252 } }),
    );
    floorplanStore.getState().select(['bed-1']);
    render(<SelectionActions />);

    fireEvent.click(screen.getByText(/Rotate/));

    const bed = floorplanStore.getState().plan.furniture.find((item) => item.id === 'bed-1')!;
    expect(bed.rotation).toBe(0);
    expect(screen.getByText(/runs into the walls/)).toBeDefined();
  });
});
