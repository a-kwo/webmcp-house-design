import { describe, expect, it } from 'vitest';
import { boundingBox, polygonAreaSqIn, roomPolygon } from './geometry';
import { DEFAULT_TEMPLATE_ID, TEMPLATES, buildTemplate, templateById } from './templates';
import { validate } from './validate';

describe('templates', () => {
  it('offers a default that exists', () => {
    expect(templateById(DEFAULT_TEMPLATE_ID)).toBeDefined();
    expect(TEMPLATES.length).toBeGreaterThanOrEqual(3);
  });

  it('builds every template to the structural invariants', () => {
    for (const template of TEMPLATES) {
      const plan = buildTemplate(template.id);

      for (const wall of plan.walls) {
        const touching = plan.rooms.filter((room) => room.wallIds.includes(wall.id));
        expect(touching.length, `${template.id}: ${wall.id}`).toBeGreaterThan(0);
        expect(touching.length, `${template.id}: ${wall.id}`).toBeLessThanOrEqual(2);
        if (!wall.exterior) {
          expect(touching, `${template.id}: interior ${wall.id}`).toHaveLength(2);
        }
      }

      for (const room of plan.rooms) {
        const poly = roomPolygon(plan, room);
        const box = boundingBox(poly);
        const rect = (box.maxX - box.minX) * (box.maxY - box.minY);
        expect(Math.abs(polygonAreaSqIn(poly) - rect), `${template.id}: ${room.id} outline`).toBeLessThan(1);
      }

      for (const opening of plan.openings) {
        const wall = plan.walls.find((candidate) => candidate.id === opening.wallId)!;
        const length = Math.hypot(wall.end.x - wall.start.x, wall.end.y - wall.start.y);
        expect(opening.offset, `${template.id}: ${opening.id}`).toBeGreaterThanOrEqual(-0.001);
        expect(opening.offset + opening.width, `${template.id}: ${opening.id}`).toBeLessThanOrEqual(length + 0.001);
      }
    }
  });

  it('opens every template violation-free', () => {
    // Violations should arise from design decisions made in the app, not
    // arrive manufactured in the starting data.
    for (const template of TEMPLATES) {
      const codes = validate(buildTemplate(template.id)).map((violation) => `${template.id}:${violation.code}`);
      expect(codes).toEqual([]);
    }
  });

  it('ships every template unfurnished', () => {
    // Furnishing the shell is the work the human and agent do together.
    for (const template of TEMPLATES) {
      expect(buildTemplate(template.id).furniture).toEqual([]);
    }
  });

  it('hands out a fresh plan each build, never a shared one', () => {
    const first = buildTemplate('studio');
    first.walls[0].start.x = -999;

    const second = buildTemplate('studio');
    expect(second.walls[0].start.x).not.toBe(-999);
  });
});
