import { TEMPLATES } from '../domain/templates';
import type { Template } from '../domain/templates';
import { useFloorplanStore } from '../state/floorplanStore';

/**
 * The design's front door: pick a shell to start from. Shown until someone
 * chooses -- and "someone" includes the agent, whose start_from_template call
 * flips the same store flag and dismisses this for the human too.
 */

const THUMB_COLORS: Record<string, string> = {
  bedroom: '#46506a',
  bathroom: '#3d5a60',
  kitchen: '#63523a',
  living: '#4a5a50',
  hallway: '#3a4045',
  closet: '#45454e',
  utility: '#3f4e3f',
  dining: '#584a58',
  garage: '#404040',
};

function Thumbnail({ template }: { template: Template }) {
  const rooms = template.spec.rooms;
  const maxX = Math.max(...rooms.map((room) => room.x + room.w));
  const maxY = Math.max(...rooms.map((room) => room.y + room.d));

  return (
    <svg viewBox={`-6 -6 ${maxX + 12} ${maxY + 12}`} className="template-thumb" aria-hidden>
      {rooms.map((room) => (
        <rect
          key={room.id}
          x={room.x}
          y={room.y}
          width={room.w}
          height={room.d}
          fill={THUMB_COLORS[room.type] ?? '#444'}
          stroke="#cfc9bd"
          strokeWidth={5}
        />
      ))}
    </svg>
  );
}

export function TemplatePicker() {
  const templateChosen = useFloorplanStore((state) => state.templateChosen);
  const floorCountChosen = useFloorplanStore((state) => state.floorCountChosen);
  const floorCount = useFloorplanStore((state) => state.floorCount);
  const configured = useFloorplanStore((state) => state.floors.length);
  const setFloorCount = useFloorplanStore((state) => state.setFloorCount);
  const loadTemplate = useFloorplanStore((state) => state.loadTemplate);

  if (templateChosen) {
    return null;
  }

  // Step one: how tall is the house? Only then, a shell per floor.
  if (!floorCountChosen) {
    return (
      <div className="template-picker" role="dialog" aria-label="Choose how many floors">
        <div className="template-picker-inner">
          <p className="eyebrow">Start designing</p>
          <h2>How many floors?</h2>
          <p className="note">
            You&rsquo;ll pick a starting layout for each floor, then edit them
            one at a time &mdash; yourself or with an agent.
          </p>
          <div className="template-cards">
            {[1, 2, 3].map((count) => (
              <button
                key={count}
                type="button"
                className="template-card floor-count-card"
                // pointerdown, not click: the first press into a newly focused
                // window can arrive without its click, and a dead first tap on
                // the opening screen reads as a broken app.
                onPointerDown={() => setFloorCount(count)}
              >
                <span className="floor-count-number">{count}</span>
                <strong>{count === 1 ? 'Single storey' : `${count} floors`}</strong>
                <span>{count === 1 ? 'Everything on one level.' : `Ground floor plus ${count - 1} more.`}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  const floorNumber = configured + 1;

  return (
    <div className="template-picker" role="dialog" aria-label="Choose a starting template">
      <div className="template-picker-inner">
        <p className="eyebrow">Start designing</p>
        <h2>
          {floorCount > 1
            ? `Choose a layout for floor ${floorNumber} of ${floorCount}`
            : 'Choose a starting layout'}
        </h2>
        <p className="note">
          Pick a shell to work from, then reshape rooms, place furniture, and
          walk through it &mdash; yourself or with an agent. Everything stays
          editable.
        </p>
        <div className="template-cards">
          {TEMPLATES.map((template) => (
            <button
              key={template.id}
              type="button"
              className="template-card"
              onPointerDown={() => loadTemplate(template.id)}
            >
              <Thumbnail template={template} />
              <strong>{template.name}</strong>
              <span>{template.description}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
