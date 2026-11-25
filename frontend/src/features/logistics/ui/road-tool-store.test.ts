// Road-tool store (ADR 0062 step 4b): the road link selection and hover
// that used to live on the interaction store. Tool-change clears are
// driven by the interaction store subscription; the cases mirror the old
// interaction-store road assertions.
import { beforeEach, describe, expect, it } from 'vitest';
import { useInteractionStore } from '../../../client/interaction-store';
import { resetClientState } from '../../../client/session';
import { useRoadToolStore } from './road-tool-store';

describe('road tool store', () => {
  beforeEach(() => {
    useInteractionStore.getState().reset();
    useRoadToolStore.getState().reset();
  });

  it('toggles road links into a sorted selection and clears on tool change', () => {
    const roadTool = useRoadToolStore.getState();
    roadTool.toggleRoadLink({ a: 2, b: 5 });
    roadTool.toggleRoadLink({ a: 1, b: 3 });
    expect(useRoadToolStore.getState().roadSel).toEqual([
      { a: 1, b: 3 },
      { a: 2, b: 5 },
    ]);
    roadTool.toggleRoadLink({ a: 1, b: 3 });
    expect(useRoadToolStore.getState().roadSel).toEqual([{ a: 2, b: 5 }]);

    roadTool.setRoadHover(3);
    useInteractionStore.getState().setMode('command');
    const after = useRoadToolStore.getState();
    expect(after.roadSel).toEqual([]);
    expect(after.roadHover).toBe(-1);
  });

  it('clears on every tool/mode transition like the old toolTransientClear', () => {
    const roadTool = useRoadToolStore.getState();
    const i = useInteractionStore.getState();
    for (const transition of [
      () => {
        i.enterPlace('frontline_td:turret');
      },
      () => {
        i.enterDemolish();
      },
      () => {
        i.enterRoad();
      },
      () => {
        i.exitTool();
      },
      () => {
        i.setMode('command');
      },
    ]) {
      roadTool.setRoadSel([{ a: 1, b: 2 }]);
      roadTool.setRoadHover(4);
      transition();
      expect(useRoadToolStore.getState().roadSel).toEqual([]);
      expect(useRoadToolStore.getState().roadHover).toBe(-1);
    }
  });

  it('clears on session reset', () => {
    const roadTool = useRoadToolStore.getState();
    roadTool.setRoadSel([{ a: 1, b: 2 }]);
    roadTool.setRoadHover(4);
    resetClientState();
    expect(useRoadToolStore.getState().roadSel).toEqual([]);
    expect(useRoadToolStore.getState().roadHover).toBe(-1);
  });
});
