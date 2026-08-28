import { sampleFloorplan } from '../domain/sampleFloorplan';
import { computeRoomSummaries } from '../domain/geometry';
import { validate } from '../domain/validate';

export function App() {
  const summaries = computeRoomSummaries(sampleFloorplan);
  const violations = validate(sampleFloorplan);

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
              <li key={room.id}>
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
      </aside>
      <section className="viewport-placeholder">
        <p>3D scene comes next. The constraint engine is live underneath.</p>
      </section>
    </main>
  );
}
