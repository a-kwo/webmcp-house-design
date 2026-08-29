// @vitest-environment jsdom
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { moveWall } from '../domain/operations';
import { floorplanStore } from '../state/floorplanStore';
import type { Variant } from '../state/floorplanStore';
import { CameraBar, VariantBar } from './Scene';

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
  floorplanStore.getState().reset();
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
