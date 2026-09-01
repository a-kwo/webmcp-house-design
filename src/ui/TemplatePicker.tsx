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
  const loadTemplate = useFloorplanStore((state) => state.loadTemplate);

  if (templateChosen) {
    return null;
  }

  return (
    <div className="template-picker" role="dialog" aria-label="Choose a starting template">
      <div className="template-picker-inner">
        <p className="eyebrow">Start designing</p>
        <h2>Choose a starting layout</h2>
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
              // pointerdown, not click: the first press into a newly focused
              // window can arrive without its click, and a dead first tap on
              // the opening screen reads as a broken app.
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
