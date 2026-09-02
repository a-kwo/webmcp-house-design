import { useEffect, useState } from 'react';
import { computeRoomSummaries } from '../domain/geometry';
import { validate } from '../domain/validate';
import { registerFloorplanTools, resolveModelContext } from '../mcp/tools';
import { Scene } from './Scene';
import { TemplatePicker } from './TemplatePicker';
import { Palette } from './Palette';
import { catalogItem } from '../domain/catalog';
import { useFloorplanStore } from '../state/floorplanStore';

export function App() {
  const plan = useFloorplanStore((state) => state.plan);
  const selection = useFloorplanStore((state) => state.selection);
  const select = useFloorplanStore((state) => state.select);
  const undo = useFloorplanStore((state) => state.undo);
  const armed = useFloorplanStore((state) => state.armed);
  const reset = useFloorplanStore((state) => state.reset);
  const undoDepth = useFloorplanStore((state) => state.undoStack.length);
  const floorCount = useFloorplanStore((state) => state.floorCount);
  const activeFloor = useFloorplanStore((state) => state.activeFloor);
  const setActiveFloor = useFloorplanStore((state) => state.setActiveFloor);
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
        {floorCount > 1 ? (
          <section>
            <h2>Floors</h2>
            <div className="floor-tabs">
              {Array.from({ length: floorCount }, (_, index) => (
                <button
                  key={index}
                  type="button"
                  className={index === activeFloor ? 'active' : undefined}
                  onClick={() => setActiveFloor(index)}
                >
                  Floor {index + 1}
                </button>
              ))}
            </div>
          </section>
        ) : null}
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
          <h2>Furniture</h2>
          <p className="note palette-hint">
            {armed?.catalogId === 'tv-stand'
              ? 'Click a floor for a TV stand, or a wall to mount it.'
              : armed
                ? 'Now click a floor to place it.'
                : 'Pick a piece, then click a floor. Drag to move, use the ring to turn.'}
          </p>
          <Palette />
        </section>
        {plan.furniture.length > 0 ? (
          <section>
            <h2>
              Placed <span className="count">{plan.furniture.length}</span>
            </h2>
            {/* Click-to-select from a list: the piece hidden behind a bed is
                unreachable by clicking the scene, and this is the inventory of
                what the design actually contains. */}
            <ul className="inventory">
              {plan.rooms
                .filter((room) => plan.furniture.some((item) => item.roomId === room.id))
                .map((room) => (
                  <li key={room.id} className="inventory-room">
                    <span className="inventory-room-name">{room.name}</span>
                    <ul>
                      {plan.furniture
                        .filter((item) => item.roomId === room.id)
                        .map((item) => (
                          <li
                            key={item.id}
                            className={selection.elementIds.includes(item.id) ? 'selected' : undefined}
                            onClick={() => select([item.id])}
                          >
                            <span>{catalogItem(item.catalogId)?.label ?? item.catalogId}</span>
                            {item.color ? <span className="swatch" style={{ background: item.color }} /> : null}
                          </li>
                        ))}
                    </ul>
                  </li>
                ))}
            </ul>
          </section>
        ) : null}
        <section>
          <h2>
            Violations <span className="count">{violations.length}</span>
          </h2>
          {violations.length === 0 ? (
            <p className="note">Nothing breaks the simplified rules right now.</p>
          ) : (
            <ul className="violations">
              {violations.map((violation, index) => (
                <li
                  // A rule can fire more than once for the same code, so the
                  // elements it names are what make the key unique.
                  key={`${violation.code}-${violation.elementIds.join('-')}-${index}`}
                  className={
                    violation.elementIds.some((id) => selection.elementIds.includes(id))
                      ? 'selected'
                      : undefined
                  }
                  // Selecting everything the violation names lights the whole
                  // problem up in the scene, not just its first element.
                  onClick={() => select(violation.elementIds)}
                >
                  <span className={`badge ${violation.severity}`}>{violation.severity}</span>
                  <p className="violation-message">{violation.message}</p>
                  {violation.suggestion ? (
                    <p className="violation-suggestion">{violation.suggestion}</p>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </section>
        <section>
          <h2>History</h2>
          <div className="history-actions">
            <button type="button" onClick={() => undo()} disabled={undoDepth === 0}>
              Undo
            </button>
            <button type="button" onClick={() => reset()} disabled={undoDepth === 0}>
              Reset
            </button>
            <code>
              {undoDepth === 0 ? 'original plan' : `${undoDepth} step${undoDepth === 1 ? '' : 's'}`}
            </code>
          </div>
        </section>
        <section>
          <h2>Agent tools</h2>
          <code>{toolsReady ? 'registered' : 'no WebMCP browser'}</code>
        </section>
      </aside>
      <Scene />
      <TemplatePicker />
    </main>
  );
}
