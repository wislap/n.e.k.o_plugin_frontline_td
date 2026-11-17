import { describe, expect, it } from 'vitest';
import { loadContent } from './load';
import { BASE_PACK_CONTENT } from './packs';
import type { ContentSource } from './load';
import { proto01 } from './frontline_td/maps/proto_01';
import { contentId } from '../core/index';
import type { MapContent } from '../features/terrain/content';

function sourceWith(overrides: Partial<ContentSource>): ContentSource {
  return { ...BASE_PACK_CONTENT, ...overrides };
}

describe('loadContent', () => {
  it('loads the base pack and exposes registries', () => {
    const db = loadContent();
    expect(db.surfaces.list.length).toBe(6);
    expect(db.movementClasses.list).toHaveLength(1);
    expect(db.movementClasses.byId('frontline_td:ground')?.index).toBe(0);
    expect(db.units.byId('frontline_td:robot')?.cellsPerTick).toBeCloseTo(0.125);
    const map = db.maps.byId('frontline_td:proto_01');
    expect(map?.grid.width).toBe(96);
    expect(map?.grid.heights).toHaveLength(96 * 64);
  });

  it('assigns numeric indices by sorting full ids', () => {
    const db = loadContent();
    const ids = db.surfaces.list.map((s) => s.id);
    expect([...ids].sort()).toEqual(ids);
  });

  it('resolves surface costs into per-class arrays', () => {
    const db = loadContent();
    const ground = db.surfaces.byId('frontline_td:ground');
    const rock = db.surfaces.byId('frontline_td:rock');
    expect(ground?.costs[0]).toBe(10);
    expect(rock?.costs[0]).toBe(-1);
  });

  it('reports a bad legend surface', () => {
    const map: MapContent = {
      ...proto01,
      legend: { '.': { surface: contentId('frontline_td:nope'), height: 0 } },
      rows: ['.'.repeat(96), ...proto01.rows.slice(1)],
    };
    expect(() => loadContent(sourceWith({ maps: [map] }))).toThrow(/unknown surface/);
  });

  it('reports a bad unit movement class', () => {
    const units = [
      {
        id: contentId('frontline_td:bad'),
        speed: 1,
        radius: 0.5,
        movementClass: contentId('frontline_td:flying'),
        hp: 100,
      },
    ];
    expect(() => loadContent(sourceWith({ units }))).toThrow(/unknown movement class/);
  });

  it('reports a bad surface cost class', () => {
    const surfaces = [
      {
        id: contentId('frontline_td:x'),
        costs: { 'frontline_td:flying': 5 },
        speedBp: 10000,
        color: '#000000',
      },
    ];
    expect(() => loadContent(sourceWith({ surfaces }))).toThrow(/unknown movement class/);
  });

  it('reports map row/width mismatches', () => {
    const map: MapContent = { ...proto01, rows: ['short', ...proto01.rows.slice(1)] };
    expect(() => loadContent(sourceWith({ maps: [map] }))).toThrow(/length/);
    const map2: MapContent = { ...proto01, rows: proto01.rows.slice(0, 63) };
    expect(() => loadContent(sourceWith({ maps: [map2] }))).toThrow(/expected 64 rows/);
  });

  it('collects all problems into one error', () => {
    const map: MapContent = { ...proto01, rows: proto01.rows.slice(0, 10) };
    const units = [
      {
        id: contentId('frontline_td:bad'),
        speed: 1,
        radius: 0.5,
        movementClass: contentId('frontline_td:flying'),
        hp: 100,
      },
    ];
    let message = '';
    try {
      loadContent(sourceWith({ maps: [map], units }));
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toContain('expected 64 rows');
    expect(message).toContain('unknown movement class');
  });
});
