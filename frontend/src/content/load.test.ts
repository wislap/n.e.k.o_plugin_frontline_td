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

describe('proto_01 outpost points (M5 batch A)', () => {
  const db = loadContent();
  const map = db.maps.byId('frontline_td:proto_01');
  const outpost = db.structures.byId('frontline_td:outpost');
  const hive = db.structures.byId('frontline_td:hive');
  const groundCls = db.movementClasses.byId('frontline_td:ground')?.index ?? -1;
  if (map === undefined || outpost === undefined || hive === undefined) {
    throw new Error('base pack map/outpost/hive missing');
  }
  const hivePoint = map.points['enemy_north'];
  const hiveCentre = {
    x: (hivePoint?.x ?? 0) + hive.footprint.w / 2,
    y: (hivePoint?.y ?? 0) + hive.footprint.h / 2,
  };

  it('exposes the three outpost points with valid 3x3 footprints', () => {
    for (const name of ['outpost_south', 'outpost_west', 'outpost_east'] as const) {
      const p = map.points[name];
      expect(p, `${name} point`).toBeDefined();
      const point = p ?? { x: 0, y: 0 };
      const cx = point.x + 1.5;
      const cy = point.y + 1.5;
      // Outside the hive exclusion radius (16 cells); squared distance,
      // purity-zone-safe (no Math.hypot).
      const dhx = cx - hiveCentre.x;
      const dhy = cy - hiveCentre.y;
      const r = hive.exclusion ?? 0;
      expect(dhx * dhx + dhy * dhy, `${name} outside hive exclusion`).toBeGreaterThan(r * r);
      let h0 = -1;
      for (let dy = 0; dy < 3; dy++) {
        for (let dx = 0; dx < 3; dx++) {
          const x = point.x + dx;
          const y = point.y + dy;
          const idx = y * map.grid.width + x;
          const surface = db.surfaces.byIndex(map.grid.surfaces[idx] ?? 0);
          // Flat, ground-passable, no ramp, not on a deposit field.
          expect(
            surface && (surface.costs[groundCls] ?? -1) >= 0,
            `${name} cell ${x},${y} passable`,
          ).toBe(true);
          expect(map.grid.ramps[idx], `${name} cell ${x},${y} off ramps`).toBe(0);
          expect(surface?.deposit, `${name} cell ${x},${y} not ore`).toBeUndefined();
          const h = map.grid.heights[idx] ?? -1;
          if (h0 < 0) {
            h0 = h;
          }
          expect(h, `${name} cell ${x},${y} flat`).toBe(h0);
        }
      }
    }
  });

  it('outpost content carries capture and exclusion profiles', () => {
    expect(outpost.footprint).toEqual({ w: 3, h: 3 });
    expect(outpost.build).toBeUndefined();
    expect(outpost.exclusion).toBe(12);
    expect(outpost.capture).toEqual({
      radius: 4,
      radiusSq: 16,
      ticks: 600,
      rebuildTicks: 400,
    });
    expect(hive.exclusion).toBe(16);
  });
});
