import { useEffect, useState } from 'react';
import { computeRoomSummaries } from '../domain/geometry';
import { validate } from '../domain/validate';
import { registerFloorplanTools, resolveModelContext } from '../mcp/tools';
import { useFloorplanStore } from '../state/floorplanStore';

export function App() {
  const plan = useFloorplanStore((state) => state.plan);
  const selection = useFloorplanStore((state) => state.selection);
  const select = useFloorplanStore((state) => state.select);
  const [toolsReady, setToolsReady] = useState(false);

  useEffect(() => {
    // Registration is skipped outside a WebMCP-capable browser so the page
    // still runs normally in plain Chrome.
    const context = resolveModelContext();
    if (!context) {
      return;
    }

    // The controller is created synchronously so the cleanup below can abort a
    // registration that has not resolved yet. StrictMode runs this effect
    // mount/unmount/mount in dev, and the API throws on a duplicate tool name,
    // so an abort that waits for the promise is already too late.
    const controller = new AbortController();

    registerFloorplanTools(context, controller.signal)
      .then(() => {
        if (!controller.signal.aborted) {
          setToolsReady(true);
        }
      })
      .catch((error: unknown) => {
        // An abort is this effect tearing itself down, not a failure.
        if (controller.signal.aborted) {
          return;
        }
        // Surface anything else rather than leaving an unhandled rejection: a
        // failure here means the agent sees no tools at all.
        console.error('[webmcp] tool registration failed', error);
      });

    return () => {
      controller.abort();
      setToolsReady(false);
    };
  }, []);

  const summaries = computeRoomSummaries(plan);
  const violations = validate(plan);

  return (
    <main className="app-shell">
      <aside className="left-rail">
        <p className="eyebrow">WebMCP Home Design</p>
        <h1>Shared floorplan workspace</h1>
        <p className="note">
          Simplified residential constraints for hackathon demos. Not building
          code compliance.
        </p>
        <section>
          <h2>Rooms</h2>
          <ul>
            {summaries.map((room) => (
              <li
                key={room.id}
                className={selection.elementIds.includes(room.id) ? 'selected' : undefined}
                onClick={() => select([room.id])}
              >
                <span>{room.name}</span>
                <code>{Math.round(room.areaSqFt)} sq ft</code>
              </li>
            ))}
          </ul>
        </section>
        <section>
          <h2>Violations</h2>
          <strong>{violations.length}</strong>
        </section>
        <section>
          <h2>Agent tools</h2>
          <code>{toolsReady ? 'registered' : 'no WebMCP browser'}</code>
        </section>
      </aside>
      <section className="viewport-placeholder">
        <p>3D scene comes next. The constraint engine and tool layer are live underneath.</p>
      </section>
    </main>
  );
}
