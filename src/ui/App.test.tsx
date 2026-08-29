// @vitest-environment jsdom
import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { moveWall } from '../domain/operations';
import { floorplanStore } from '../state/floorplanStore';
import { App } from './App';

// The 3D scene needs a WebGL context that jsdom does not have, and none of
// these assertions are about it.
vi.mock('./Scene', () => ({ Scene: () => null }));

/**
 * Stands in for the page's WebMCP endpoint, with the two behaviours that make
 * the real one awkward: registerTool resolves to nothing, and it throws when a
 * name is already taken.
 */
function fakeModelContext() {
  const registered = new Map<string, unknown>();

  return {
    registered,
    registerTool: async (tool: { name: string }, options?: { signal?: AbortSignal }) => {
      if (options?.signal?.aborted) {
        throw new DOMException('Aborted', 'AbortError');
      }
      if (registered.has(tool.name)) {
        throw new Error(`Duplicate tool name: ${tool.name}`);
      }
      registered.set(tool.name, tool);
      options?.signal?.addEventListener('abort', () => registered.delete(tool.name), { once: true });
    },
  };
}

type Contextual = { modelContext?: unknown };

function installContext() {
  const context = fakeModelContext();
  (document as unknown as Contextual).modelContext = context;
  return context;
}

beforeEach(() => {
  floorplanStore.getState().reset();
});

afterEach(() => {
  cleanup();
  delete (document as unknown as Contextual).modelContext;
  vi.restoreAllMocks();
});

describe('tool registration', () => {
  it('registers the tool set against a WebMCP page', async () => {
    const context = installContext();
    render(<App />);

    await waitFor(() => expect(screen.getByText('registered')).toBeDefined());
    expect(context.registered.has('get_layout')).toBe(true);
    expect(context.registered.has('move_wall')).toBe(true);
  });

  it('says so plainly in a browser without WebMCP', () => {
    render(<App />);

    expect(screen.getByText('no WebMCP browser')).toBeDefined();
  });

  it('survives StrictMode mounting the effect twice', async () => {
    // The API throws on a duplicate name and offers no disposer, so the second
    // pass collides unless the cleanup aborts before the first one resolves.
    const failed = vi.spyOn(console, 'error').mockImplementation(() => {});
    installContext();

    render(
      <StrictMode>
        <App />
      </StrictMode>,
    );

    await waitFor(() => expect(screen.getByText('registered')).toBeDefined());
    expect(failed).not.toHaveBeenCalledWith('[webmcp] tool registration failed', expect.anything());
  });

  it('unregisters everything when the page goes away', async () => {
    const context = installContext();
    const view = render(<App />);

    await waitFor(() => expect(context.registered.size).toBeGreaterThan(0));
    view.unmount();

    await waitFor(() => expect(context.registered.size).toBe(0));
  });
});

describe('violations panel', () => {
  it('shows the message and the suggestion, not just a count', () => {
    render(<App />);

    expect(screen.getByText(/Door hall-bath is 30in clear/)).toBeDefined();
    expect(screen.getByText(/Widen hall-bath by 2in/)).toBeDefined();
    expect(screen.getByText('error')).toBeDefined();
  });

  it('selects every element a violation names, so the whole problem lights up', () => {
    render(<App />);

    fireEvent.click(screen.getByText(/Door hall-bath is 30in clear/));

    expect(floorplanStore.getState().selection.elementIds).toEqual(['hall-bath', 'hall-W']);
  });

  it('reports a clean plan rather than showing an empty list', () => {
    const widened = structuredClone(floorplanStore.getState().plan);
    widened.openings.find((opening) => opening.id === 'hall-bath')!.width = 32;
    floorplanStore.setState({ plan: widened });

    render(<App />);

    expect(screen.getByText(/Nothing breaks the simplified rules/)).toBeDefined();
  });
});

describe('room list', () => {
  it('selects a room, which is what get_selection reports', () => {
    render(<App />);

    fireEvent.click(screen.getByText('Bedroom 2'));

    expect(floorplanStore.getState().selection).toEqual({ elementIds: ['bed2'], kind: 'room' });
  });
});

describe('history controls', () => {
  it('stays disabled until there is something to undo', () => {
    render(<App />);

    expect(screen.getByText('Undo').hasAttribute('disabled')).toBe(true);
    expect(screen.getByText('original plan')).toBeDefined();
  });

  it('walks an edit back off the stack', async () => {
    render(<App />);

    const before = floorplanStore.getState().plan;
    floorplanStore.getState().applyOperation((plan) =>
      moveWall(plan, { wallId: 'hall-E', distanceIn: 12, direction: 'east' }),
    );

    await waitFor(() => expect(screen.getByText('1 step')).toBeDefined());
    fireEvent.click(screen.getByText('Undo'));

    expect(floorplanStore.getState().plan).toEqual(before);
    expect(screen.getByText('original plan')).toBeDefined();
  });
});
