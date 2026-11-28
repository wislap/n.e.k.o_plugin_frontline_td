import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import type { EffectComposer, Pass } from 'postprocessing';
import { installGpuInstrumentation, materialLabel, resolveSceneLayerId } from './gpu-instrument';

const EXT = { TIME_ELAPSED_EXT: 0x88bf, GPU_DISJOINT_EXT: 0x8fbb };
const QUERY_RESULT_AVAILABLE = 0x8867;

interface FakeQuery {
  id: number;
}

function createFakeRendererAndGl() {
  let nextId = 0;
  let open: FakeQuery | null = null;
  const results = new Map<number, number>();
  const deletedIds: number[] = [];

  const gl = {
    getExtension(name: string) {
      return name === 'EXT_disjoint_timer_query_webgl2' ? EXT : null;
    },
    createQuery(): object {
      return { id: nextId++ };
    },
    deleteQuery(q: object): void {
      deletedIds.push((q as FakeQuery).id);
    },
    beginQuery(_target: number, q: object): void {
      open = q as FakeQuery;
    },
    endQuery(): void {
      if (open !== null) {
        results.set(open.id, 10_000);
        open = null;
      }
    },
    getQueryParameter(q: object, pname: number): unknown {
      const ns = results.get((q as FakeQuery).id);
      if (ns === undefined) {
        return undefined;
      }
      return pname === QUERY_RESULT_AVAILABLE ? true : ns;
    },
    getParameter(pname: number): unknown {
      return pname === EXT.GPU_DISJOINT_EXT ? false : undefined;
    },
  };

  const info = {
    autoReset: true,
    reset: vi.fn(),
  };
  const shadowRender = vi.fn();
  const shadowMap = { render: shadowRender };

  const renderer = {
    getContext: () => gl,
    info,
    shadowMap,
  } as unknown as THREE.WebGLRenderer;

  const passRender = vi.fn();
  const pass = { name: 'scene', render: passRender } as unknown as Pass;
  const composer = { passes: [pass] } as unknown as EffectComposer;

  return { renderer, composer, info, shadowMap, shadowRender, pass, passRender, deletedIds };
}

type FakeObject = {
  parent: FakeObject | null;
  userData: Record<string, unknown>;
};

const obj = (
  userData: Record<string, unknown> = {},
  parent: FakeObject | null = null,
): FakeObject => ({
  parent,
  userData,
});

describe('resolveSceneLayerId', () => {
  it('finds the nearest ancestor carrying sceneLayerId', () => {
    const tagged = obj({ sceneLayerId: 'units' });
    const mid = obj({}, tagged);
    const leaf = obj({}, mid);
    expect(resolveSceneLayerId(leaf)).toBe('units');
    expect(resolveSceneLayerId(tagged)).toBe('units');
  });

  it('uses the nearest tag when nested groups both carry ids', () => {
    const outer = obj({ sceneLayerId: 'terrain' });
    const inner = obj({ sceneLayerId: 'overlay' }, outer);
    expect(resolveSceneLayerId(obj({}, inner))).toBe('overlay');
  });

  it('falls back to shell outside the registry layers', () => {
    const root = obj({});
    const leaf = obj({}, root);
    expect(resolveSceneLayerId(leaf)).toBe('shell');
    expect(resolveSceneLayerId(root)).toBe('shell');
  });
});

describe('materialLabel', () => {
  it('prefers an authored material name over the type', () => {
    expect(materialLabel({ name: 'coverRing', type: 'MeshBasicMaterial' })).toBe('coverRing');
  });

  it('falls back to the material type', () => {
    expect(materialLabel({ name: '', type: 'MeshStandardMaterial' })).toBe('MeshStandardMaterial');
    expect(materialLabel({ type: 'MeshDepthMaterial' })).toBe('MeshDepthMaterial');
  });

  it('handles arrays and missing material', () => {
    expect(materialLabel([{ type: 'MeshBasicMaterial' }])).toBe('multi');
    expect(materialLabel(null)).toBe('none');
  });
});

describe('installGpuInstrumentation perObject gate', () => {
  it('defaults perObject to false and skips scene.traverse in endFrame', () => {
    const { renderer, composer } = createFakeRendererAndGl();
    const scene = new THREE.Scene();
    const group = new THREE.Group();
    group.userData['sceneLayerId'] = 'units';
    const mesh = new THREE.Mesh(
      new THREE.BufferGeometry(),
      new THREE.MeshBasicMaterial({ name: 'unitMat' }),
    );
    const origBefore: unknown = Reflect.get(mesh, 'onBeforeRender');
    const origAfter: unknown = Reflect.get(mesh, 'onAfterRender');
    group.add(mesh);
    scene.add(group);

    const traverseSpy = vi.spyOn(scene, 'traverse');
    const instr = installGpuInstrumentation(renderer, () => composer, scene);

    expect(traverseSpy).not.toHaveBeenCalled();
    expect(Reflect.get(mesh, 'onBeforeRender')).toBe(origBefore);
    expect(Reflect.get(mesh, 'onAfterRender')).toBe(origAfter);

    instr.beginFrame();
    composer.passes[0]?.render(renderer, null, null);
    instr.endFrame();

    expect(traverseSpy).not.toHaveBeenCalled();
    expect(Reflect.get(mesh, 'onBeforeRender')).toBe(origBefore);
    instr.uninstall();
  });

  it('wraps objects when setPerObject(true) and restores/resets cleanly on false -> true -> uninstall', () => {
    const { renderer, composer, info, shadowRender, pass, passRender, deletedIds } =
      createFakeRendererAndGl();
    const scene = new THREE.Scene();
    const group = new THREE.Group();
    group.userData['sceneLayerId'] = 'structures';
    const mesh = new THREE.Mesh(
      new THREE.BufferGeometry(),
      new THREE.MeshBasicMaterial({ name: 'padMat' }),
    );
    const origBefore: unknown = Reflect.get(mesh, 'onBeforeRender');
    const origAfter: unknown = Reflect.get(mesh, 'onAfterRender');
    group.add(mesh);
    scene.add(group);

    const traverseSpy = vi.spyOn(scene, 'traverse');
    const instr = installGpuInstrumentation(renderer, () => composer, scene);

    // Enable perObject: wraps existing mesh and records layer/material span.
    instr.setPerObject(true);
    expect(traverseSpy).toHaveBeenCalledTimes(1);
    expect(Reflect.get(mesh, 'onBeforeRender')).not.toBe(origBefore);
    expect(Reflect.get(mesh, 'onAfterRender')).not.toBe(origAfter);

    const camera = new THREE.PerspectiveCamera();
    const geo = mesh.geometry;
    const mat = mesh.material;

    instr.beginFrame();
    pass.render(renderer, null, null);
    mesh.onBeforeRender(renderer, scene, camera, geo, mat, group);
    mesh.onAfterRender(renderer, scene, camera, geo, mat, group);
    instr.endFrame();

    // Next frame commits frame 0.
    instr.beginFrame();
    pass.render(renderer, null, null);
    instr.endFrame();

    let snap = instr.profiler.snapshot();
    expect(snap.labels.some((l) => l.label === 'structures/padMat')).toBe(true);

    // Toggle off: restores original callbacks, stops traverse, clears history.
    traverseSpy.mockClear();
    instr.setPerObject(false);
    expect(Reflect.get(mesh, 'onBeforeRender')).toBe(origBefore);
    expect(Reflect.get(mesh, 'onAfterRender')).toBe(origAfter);
    snap = instr.profiler.snapshot();
    expect(snap.labels).toEqual([]);

    instr.beginFrame();
    instr.endFrame();
    expect(traverseSpy).not.toHaveBeenCalled();

    // Re-enable: wraps again cleanly (wrappedObjects reset).
    instr.setPerObject(true);
    expect(Reflect.get(mesh, 'onBeforeRender')).not.toBe(origBefore);

    // Uninstall restores both objects and pass/shadow/info wrappers and disposes profiler.
    instr.uninstall();
    expect(Reflect.get(mesh, 'onBeforeRender')).toBe(origBefore);
    expect(Reflect.get(mesh, 'onAfterRender')).toBe(origAfter);
    expect(info.autoReset).toBe(true);
    expect(Reflect.get(renderer.shadowMap, 'render')).toBe(shadowRender);
    expect(Reflect.get(pass, 'render')).toBe(passRender);
    expect(deletedIds.length).toBeGreaterThan(0);
  });

  it('does not throw when getComposer returns undefined on frame 0 and wraps once mounted', () => {
    const { renderer, composer, pass, passRender } = createFakeRendererAndGl();
    const scene = new THREE.Scene();
    let current: EffectComposer | null | undefined = undefined;

    const instr = installGpuInstrumentation(renderer, () => current, scene);
    instr.beginFrame();
    instr.endFrame();
    expect(Reflect.get(pass, 'render')).toBe(passRender);

    current = composer;
    instr.beginFrame();
    instr.endFrame();
    expect(Reflect.get(pass, 'render')).not.toBe(passRender);

    instr.uninstall();
    expect(Reflect.get(pass, 'render')).toBe(passRender);
  });
});
