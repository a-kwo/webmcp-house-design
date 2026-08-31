import { useState } from 'react';
import { CATALOG, CATALOG_CATEGORIES, FINISHES } from '../domain/catalog';
import { useFloorplanStore } from '../state/floorplanStore';

/**
 * The furniture palette: categories fold out, each item arms on click, and a
 * swatch row per item picks a finish. No finish chosen means the default look
 * -- configuration is optional, not a gate.
 *
 * The chosen finish rides along in the store's `armed` slot, so the placement
 * click in the 3D scene needs no knowledge of this panel.
 */
export function Palette() {
  const armed = useFloorplanStore((state) => state.armed);
  const armCatalog = useFloorplanStore((state) => state.armCatalog);
  const [openCategory, setOpenCategory] = useState<string | null>(CATALOG_CATEGORIES[0]);
  const [openConfig, setOpenConfig] = useState<string | null>(null);
  const [finishes, setFinishes] = useState<Record<string, string | undefined>>({});

  const arm = (catalogId: string) => {
    if (armed?.catalogId === catalogId) {
      armCatalog(null);
      return;
    }
    armCatalog(catalogId, finishes[catalogId]);
  };

  const pickFinish = (catalogId: string, color: string | undefined) => {
    setFinishes((current) => ({ ...current, [catalogId]: color }));
    // Re-arm with the new finish if this item is the one about to be placed.
    if (armed?.catalogId === catalogId) {
      armCatalog(catalogId, color);
    }
  };

  return (
    <div className="palette">
      {CATALOG_CATEGORIES.map((category) => {
        const items = CATALOG.filter((item) => item.category === category);
        const open = openCategory === category;

        return (
          <div key={category} className="palette-category">
            <button
              type="button"
              className="palette-category-header"
              onClick={() => setOpenCategory(open ? null : category)}
              aria-expanded={open}
            >
              <span>{category}</span>
              <span className="palette-caret">{open ? '▾' : '▸'}</span>
            </button>
            {open ? (
              <ul className="palette-items">
                {items.map((item) => {
                  const isArmed = armed?.catalogId === item.id;
                  const finish = finishes[item.id];
                  const configOpen = openConfig === item.id;

                  return (
                    <li key={item.id} className={isArmed ? 'palette-item armed' : 'palette-item'}>
                      <div className="palette-item-row">
                        <button type="button" className="palette-item-name" onClick={() => arm(item.id)}>
                          {item.label}
                          <span className="palette-size">{item.w}&times;{item.d}in</span>
                        </button>
                        {item.tintable === false ? null : (
                          <button
                            type="button"
                            className="palette-config-toggle"
                            aria-label={`Configure ${item.label}`}
                            onClick={() => setOpenConfig(configOpen ? null : item.id)}
                          >
                            <span className="swatch" style={{ background: finish ?? '#8a7358' }} />
                          </button>
                        )}
                      </div>
                      {configOpen && item.tintable !== false ? (
                        <div className="palette-config">
                          <button
                            type="button"
                            className={finish === undefined ? 'swatch-option default active' : 'swatch-option default'}
                            onClick={() => pickFinish(item.id, undefined)}
                          >
                            Default
                          </button>
                          {FINISHES.map((option) => (
                            <button
                              key={option.value}
                              type="button"
                              title={option.label}
                              className={finish === option.value ? 'swatch-option active' : 'swatch-option'}
                              style={{ background: option.value }}
                              onClick={() => pickFinish(item.id, option.value)}
                            />
                          ))}
                        </div>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
