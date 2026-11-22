import { contentId, toTick, type EntityId } from '../../src/core/index';
import { loadContent, type ResolvedStructure, type ResolvedUnit } from '../../src/content/index';
import {
  structureParts as combatStructureParts,
  unitParts as combatUnitParts,
} from '../../src/features/combat/sim/index';
import { MoveCommand, moverComponents, Position } from '../../src/features/movement/sim/index';
import { CLEARANCE_HEAVY, clearanceAnchorCenter } from '../../src/features/terrain/rules/index';
import { Faction, InWorld, type SimModule } from '../../src/kernel/index';
import type { ScenarioSpec } from './types';
import {
  createScenarioSim,
  encodeCharGrid,
  F1,
  F2,
  makeGrid,
  paintRect,
  requireUnit,
  runMoveScenario,
  runSquadScenario,
} from './world';

function makeHeavyVanguardModule(
  terrain: Parameters<NonNullable<Parameters<typeof runSquadScenario>[0]['extraModules']>>[0],
  anchors: readonly (readonly [number, number])[],
): SimModule {
  const db = loadContent();
  const crawler = requireUnit('frontline_td:crawler');
  const groundCls = db.movementClasses.byId('frontline_td:ground')?.index ?? 0;
  const heavyUnit: ResolvedUnit = {
    id: contentId('frontline_td:crawler'),
    index: crawler.index,
    cellsPerTick: 1.8 / 20,
    radius: 0.65,
    movementClass: groundCls,
    hp: 150,
    weapon: { range: 2, damageMilli: 10000, cooldownTicks: 20, costCargo: -1, costMilli: 0 },
    visual: { shape: 'box', scale: 1 },
    vision: 6,
  };
  return {
    id: 'frontline_td:eval.heavy_vanguard',
    install(builder) {
      builder.onStart((ctx) => {
        for (const [ax, ay] of anchors) {
          if (!terrain.passable(ax, ay, groundCls, CLEARANCE_HEAVY)) {
            throw new Error(`heavy anchor (${ax},${ay}) not passable`);
          }
          ctx.spawn([
            [Faction, { id: F1 }],
            [InWorld],
            ...moverComponents(
              clearanceAnchorCenter(ax, CLEARANCE_HEAVY),
              clearanceAnchorCenter(ay, CLEARANCE_HEAVY),
              heavyUnit.cellsPerTick,
              heavyUnit.radius,
              groundCls,
            ),
            ...combatUnitParts(heavyUnit),
          ]);
        }
      });
    },
  };
}

function s1WatershedSplit(): ScenarioSpec {
  const charGrid = makeGrid(48, 32, '.');
  paintRect(charGrid, 21, 13, 26, 17, '#');
  const grid = encodeCharGrid(charGrid);
  const goal = { x: 40, y: 15 };
  const ticks = 420;
  return {
    id: 'S1_watershed_split',
    title: 'S1 巨石中线分水岭',
    description: '24 混编单位跨中线对称展开并正对 6x5 岩石行军，检测绕障是否整队同侧通过而不分裂',
    ticks,
    orderStartTick: 4,
    goal,
    run() {
      const crawler = requireUnit('frontline_td:crawler');
      const robot = requireUnit('frontline_td:robot');
      return runSquadScenario({
        grid,
        factions: [F1],
        relations: [],
        starts: [
          {
            faction: F1,
            units: [
              { kind: crawler.index, x: 9, y: 12, count: 4 },
              { kind: crawler.index, x: 9, y: 18, count: 4 },
              { kind: robot.index, x: 7, y: 12, count: 8 },
              { kind: robot.index, x: 7, y: 18, count: 8 },
            ],
          },
        ],
        goal,
        ticks,
      });
    },
  };
}

function s2Proto01BridgeMixed(): ScenarioSpec {
  const goal = { x: 66, y: 22 };
  const ticks = 1100;
  return {
    id: 'S2_proto01_bridge_mixed',
    title: 'S2 proto_01 斜坡与斜向窄桥混编',
    description: '2 台 2x2 重型前排 + 22 轻型单位从高台下坡并跨过中央 2 格斜向河桥前往东侧前哨',
    ticks,
    orderStartTick: 4,
    goal,
    chokepointGate: { x0: 51.5, y0: 29.0, x1: 51.5, y1: 33.0, nx: 1, ny: 0 },
    viewport: { x0: 4, y0: 16, w: 68, h: 44 },
    run() {
      const db = loadContent();
      const map = db.maps.byId('frontline_td:proto_01');
      if (map === undefined) {
        throw new Error('missing proto_01');
      }
      const crawler = requireUnit('frontline_td:crawler');
      const robot = requireUnit('frontline_td:robot');
      return runSquadScenario({
        grid: map.grid,
        factions: [F1],
        relations: [],
        starts: [
          {
            faction: F1,
            units: [
              { kind: crawler.index, x: 9, y: 55, count: 6 },
              { kind: robot.index, x: 7, y: 55, count: 16 },
            ],
          },
        ],
        goal,
        ticks,
        extraModules: (terrain) => [
          makeHeavyVanguardModule(terrain, [
            [12, 51],
            [15, 51],
          ]),
        ],
      });
    },
  };
}

function s3TightSCorridor(): ScenarioSpec {
  const charGrid = makeGrid(44, 28, '#');
  paintRect(charGrid, 2, 4, 9, 10, '.');
  paintRect(charGrid, 9, 6, 21, 7, '.');
  paintRect(charGrid, 20, 6, 21, 21, '.');
  paintRect(charGrid, 20, 20, 34, 21, '.');
  paintRect(charGrid, 34, 17, 41, 24, '.');
  const grid = encodeCharGrid(charGrid);
  const goal = { x: 38, y: 20 };
  const ticks = 550;
  return {
    id: 'S3_tight_s_corridor',
    title: 'S3 2格宽 S 型贴墙连弯走廊',
    description: '20 单位连续穿越两处 90 度 2 格窄弯通道，检验贴墙梯度退化、刮墙减速与弯角折线抖动',
    ticks,
    orderStartTick: 2,
    goal,
    chokepointGate: { x0: 19.8, y0: 13.5, x1: 22.2, y1: 13.5, nx: 0, ny: 1 },
    run() {
      const robot = requireUnit('frontline_td:robot');
      return runMoveScenario({
        grid,
        starts: [{ faction: F1, units: [{ kind: robot.index, x: 5, y: 7, count: 20 }] }],
        goal,
        ticks,
      });
    },
  };
}

function s4CorridorHeadOn(): ScenarioSpec {
  const charGrid = makeGrid(44, 20, '#');
  paintRect(charGrid, 2, 4, 12, 15, '.');
  paintRect(charGrid, 31, 4, 41, 15, '.');
  paintRect(charGrid, 12, 8, 31, 9, '.');
  const grid = encodeCharGrid(charGrid);
  const ticks = 480;
  return {
    id: 'S4_corridor_head_on',
    title: 'S4 2格通道友军双向对穿',
    description: '左右两支 12 人友军在 2 格宽窄通道正面对穿，检验极限错车让行与窄道顶牛死锁',
    ticks,
    orderStartTick: 2,
    goal: { x: 37, y: 8 },
    chokepointGate: { x0: 22.0, y0: 7.8, x1: 22.0, y1: 10.2, nx: 1, ny: 0, bidirectional: true },
    run() {
      const robot = requireUnit('frontline_td:robot');
      const t0 = performance.now();
      const { sim, terrain, pathing, probe } = createScenarioSim({
        grid,
        factions: [F1],
        relations: [],
        starts: [
          {
            faction: F1,
            units: [
              { kind: robot.index, x: 7, y: 8, count: 12 },
              { kind: robot.index, x: 37, y: 9, count: 12 },
            ],
          },
        ],
        ticks,
      });
      sim.step();
      const initUnits = probe.initialUnits();
      const g1Handles: number[] = [];
      const g2Handles: number[] = [];
      const unitGoals = new Map<number, { x: number; y: number }>();
      for (const u of initUnits) {
        if (u.x < 22) {
          probe.setGroup(u.handle, 1);
          g1Handles.push(u.handle);
          unitGoals.set(u.handle, { x: 37, y: 8 });
        } else {
          probe.setGroup(u.handle, 2);
          g2Handles.push(u.handle);
          unitGoals.set(u.handle, { x: 7, y: 9 });
        }
      }
      sim.submit({
        tick: toTick(2),
        issuer: F1,
        type: MoveCommand.type,
        payload: { units: g1Handles, x: 37, y: 8 },
      });
      sim.submit({
        tick: toTick(2),
        issuer: F1,
        type: MoveCommand.type,
        payload: { units: g2Handles, x: 7, y: 9 },
      });
      while ((sim.tick as number) < ticks) {
        sim.step();
      }
      return {
        grid,
        terrain,
        pathing,
        recording: probe.finalize(),
        unitGoals,
        structures: [],
        hash: sim.hash(),
        simMs: performance.now() - t0,
      };
    },
  };
}

function s5PocketArrival(): ScenarioSpec {
  const charGrid = makeGrid(40, 28, '.');
  paintRect(charGrid, 27, 10, 35, 10, '#');
  paintRect(charGrid, 27, 18, 35, 18, '#');
  paintRect(charGrid, 35, 10, 35, 18, '#');
  const grid = encodeCharGrid(charGrid);
  const goal = { x: 33, y: 14 };
  const ticks = 420;
  return {
    id: 'S5_pocket_arrival',
    title: 'S5 三面环墙口袋阵地集结',
    description: '24 单位集中冲向三面靠墙口袋底部，检验到点后的挤压沸腾与速度收敛停稳耗时',
    ticks,
    orderStartTick: 2,
    goal,
    run() {
      const robot = requireUnit('frontline_td:robot');
      return runMoveScenario({
        grid,
        starts: [{ faction: F1, units: [{ kind: robot.index, x: 8, y: 14, count: 24 }] }],
        goal,
        ticks,
      });
    },
  };
}

function s6EngageSurround(): ScenarioSpec {
  const charGrid = makeGrid(48, 28, '.');
  paintRect(charGrid, 18, 0, 22, 11, '#');
  paintRect(charGrid, 18, 16, 22, 27, '#');
  const grid = encodeCharGrid(charGrid);
  const goal = { x: 35, y: 14 };
  const ticks = 400;
  return {
    id: 'S6_engage_surround',
    title: 'S6 纵队遇敌停走分裂与火力展开',
    description: '24 远程单位穿 4 格窄口迎面遭遇敌方要塞，测前排急停开火后后排绕开弧形展开的速度',
    ticks,
    orderStartTick: 4,
    goal,
    expectCombat: true,
    run() {
      const robot = requireUnit('frontline_td:robot');
      const outpost = loadContent().structures.byId('frontline_td:outpost');
      if (outpost === undefined) {
        throw new Error('missing outpost');
      }
      const bastion: ResolvedStructure = {
        id: outpost.id,
        index: outpost.index,
        footprint: { w: 3, h: 3 },
        hp: 8000,
        vision: outpost.vision,
        visual: outpost.visual,
      };
      const bastionCells: { x: number; y: number }[] = [];
      for (let dy = 0; dy < 3; dy++) {
        for (let dx = 0; dx < 3; dx++) {
          bastionCells.push({ x: 34 + dx, y: 13 + dy });
        }
      }
      const bastionModule = (
        terrain: Parameters<NonNullable<Parameters<typeof runSquadScenario>[0]['extraModules']>>[0],
      ): SimModule => ({
        id: 'frontline_td:eval.bastion',
        install(builder) {
          builder.onStart((ctx) => {
            terrain.setBlocked(bastionCells, true);
            ctx.spawn([
              [Faction, { id: F2 }],
              [InWorld],
              [Position, { x: 35.5, y: 14.5 }],
              ...combatStructureParts(bastion),
            ]);
          });
        },
      });
      return runSquadScenario({
        grid,
        factions: [F1, F2],
        relations: [{ a: F1, b: F2, relation: 'hostile' }],
        starts: [{ faction: F1, units: [{ kind: robot.index, x: 7, y: 14, count: 24 }] }],
        goal,
        ticks,
        structures: [{ x: 34, y: 13, w: 3, h: 3, label: 'Bastion' }],
        extraModules: (terrain) => [bastionModule(terrain)],
      });
    },
  };
}

function s7MidMarchWalloff(): ScenarioSpec {
  const charGrid = makeGrid(48, 32, '.');
  paintRect(charGrid, 23, 0, 25, 31, '~');
  paintRect(charGrid, 23, 7, 25, 9, '.');
  paintRect(charGrid, 23, 22, 25, 24, '.');
  const grid = encodeCharGrid(charGrid);
  const goal = { x: 40, y: 14 };
  const ticks = 600;
  return {
    id: 'S7_mid_march_walloff',
    title: 'S7 行军中途动态封桥改道',
    description: '24 单位行至北桥前时动态封堵北桥，检验全体重规划转赴南桥时的踩踏、分裂与改道延迟',
    ticks,
    orderStartTick: 4,
    goal,
    chokepointGate: { x0: 24.5, y0: 21.8, x1: 24.5, y1: 25.2, nx: 1, ny: 0 },
    run() {
      const robot = requireUnit('frontline_td:robot');
      const northCells: { x: number; y: number }[] = [];
      for (let y = 7; y <= 9; y++) {
        for (let x = 23; x <= 25; x++) {
          northCells.push({ x, y });
        }
      }
      const triggerModule = (
        terrain: Parameters<NonNullable<Parameters<typeof runSquadScenario>[0]['extraModules']>>[0],
        probe: Parameters<NonNullable<Parameters<typeof runSquadScenario>[0]['extraModules']>>[1],
      ): SimModule => {
        let triggered = false;
        return {
          id: 'frontline_td:eval.walloff_trigger',
          install(builder) {
            builder.system({
              id: 'frontline_td:eval.walloff_trigger.check',
              phase: 'orders',
              run(ctx) {
                if (triggered) {
                  return;
                }
                const pos = ctx.read(Position);
                const fac = ctx.read(Faction);
                for (const id of ctx.query([Position, Faction, InWorld])) {
                  if ((fac.id[id as EntityId] ?? 0) !== 1) {
                    continue;
                  }
                  const px = pos.x[id as EntityId] ?? 0;
                  if (px >= 19.5 && px < 22.5) {
                    triggered = true;
                    terrain.setBlocked(northCells, true);
                    probe.recordBlockerChange(ctx.tick, northCells);
                    break;
                  }
                }
              },
            });
          },
        };
      };
      return runSquadScenario({
        grid,
        factions: [F1],
        relations: [],
        starts: [{ faction: F1, units: [{ kind: robot.index, x: 8, y: 8, count: 24 }] }],
        goal,
        ticks,
        extraModules: (terrain, probe) => [triggerModule(terrain, probe)],
      });
    },
  };
}

function s8MixedTierShortcutSplit(): ScenarioSpec {
  const charGrid = makeGrid(48, 32, '.');
  paintRect(charGrid, 22, 0, 25, 31, '#');
  paintRect(charGrid, 22, 13, 25, 13, '.');
  paintRect(charGrid, 22, 22, 25, 24, '.');
  const grid = encodeCharGrid(charGrid);
  const goal = { x: 40, y: 14 };
  const ticks = 520;
  return {
    id: 'S8_mixed_tier_shortcut_split',
    title: 'S8 轻重混编窄缝分道陷阱',
    description:
      '2 台 2x2 重型 + 18 轻型混编，北有 1 格窄缝、南有 3 格宽道，检验轻重成员是否分头抄近道拆队',
    ticks,
    orderStartTick: 4,
    goal,
    run() {
      const robot = requireUnit('frontline_td:robot');
      return runSquadScenario({
        grid,
        factions: [F1],
        relations: [],
        starts: [{ faction: F1, units: [{ kind: robot.index, x: 6, y: 14, count: 18 }] }],
        goal,
        ticks,
        extraModules: (terrain) => [
          makeHeavyVanguardModule(terrain, [
            [9, 13],
            [9, 15],
          ]),
        ],
      });
    },
  };
}

export const LOCOMOTION_SCENARIOS: readonly ScenarioSpec[] = [
  s1WatershedSplit(),
  s2Proto01BridgeMixed(),
  s3TightSCorridor(),
  s4CorridorHeadOn(),
  s5PocketArrival(),
  s6EngageSurround(),
  s7MidMarchWalloff(),
  s8MixedTierShortcutSplit(),
];
