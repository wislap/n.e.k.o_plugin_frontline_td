// GPU instrumentation installer (dev DebugPanel only): wraps the
// shadow-map render, every composer pass, and every effect's update
// (bloom mip blur / SMAA edges live there) with profiler spans, and
// takes over gl.info resets so the counters reflect a whole frame.
// Install/uninstall is driven by the PerfProbe mount while the panel is
// open; everything is restored on uninstall.
import * as THREE from 'three';
import {
  EffectPass,
  RenderPass,
  type Effect,
  type EffectComposer,
  type Pass,
} from 'postprocessing';
import { GpuProfiler } from './gpu-profiler';

export interface GpuInstrumentation {
  readonly profiler: GpuProfiler;
  beginFrame(): void;
  endFrame(): void;
  setPerObject(enabled: boolean): void;
  uninstall(): void;
}

// Label for a composer pass: the RenderPass is the scene draw itself;
// Pass.name survives minification (EffectPass, CopyPass). N8AOPostPass
// leaves the default 'Pass' name, so it is recognised by its API.
function passLabel(pass: Pass): string {
  if (pass instanceof RenderPass) {
    return 'scene';
  }
  if (typeof (pass as { setQualityMode?: unknown }).setQualityMode === 'function') {
    return 'n8ao';
  }
  return pass.name !== '' && pass.name !== 'Pass' ? pass.name : pass.constructor.name || 'pass';
}

// Objects that carry geometry into a draw call.
function isDrawable(object: THREE.Object3D): boolean {
  return (
    object instanceof THREE.Mesh ||
    object instanceof THREE.InstancedMesh ||
    object instanceof THREE.Points ||
    object instanceof THREE.Line
  );
}

type MaterialLike = { readonly name?: string; readonly type?: string };

// Per-object label suffix: material name if authored, else its type.
export function materialLabel(material: MaterialLike | MaterialLike[] | null): string {
  if (material === null) {
    return 'none';
  }
  if (Array.isArray(material)) {
    return 'multi';
  }
  const name = material.name ?? '';
  if (name !== '') {
    return name;
  }
  return material.type ?? 'material';
}

type LayerTaggedObject = {
  parent: LayerTaggedObject | null;
  userData: Record<string, unknown>;
};

// Walks ancestors for the sceneLayerId that GameCanvas stamps on each
// registry layer's wrapper group; anything outside gets 'shell'.
export function resolveSceneLayerId(object: LayerTaggedObject): string {
  let node: LayerTaggedObject | null = object;
  while (node !== null) {
    const id = node.userData['sceneLayerId'];
    if (typeof id === 'string') {
      return id;
    }
    node = node.parent;
  }
  return 'shell';
}

interface ObjectRestore {
  readonly ref: WeakRef<THREE.Object3D>;
  readonly before: THREE.Object3D['onBeforeRender'];
  readonly after: THREE.Object3D['onAfterRender'];
}

export function installGpuInstrumentation(
  renderer: THREE.WebGLRenderer,
  getComposer: () => EffectComposer | null | undefined,
  scene: THREE.Object3D,
  options?: { perObject?: boolean },
): GpuInstrumentation {
  const profiler = GpuProfiler.fromContext(renderer.getContext() as WebGL2RenderingContext);
  const restores: Array<() => void> = [];
  let installed = true;
  let perObjectEnabled = options?.perObject ?? false;

  const info = renderer.info;
  const prevAutoReset = info.autoReset;
  info.autoReset = false;
  restores.push(() => {
    info.autoReset = prevAutoReset;
  });

  const shadowMap = renderer.shadowMap as unknown as { render: (...args: never[]) => unknown };
  const shadowRender = shadowMap.render;
  shadowMap.render = function (this: unknown, ...args: never[]) {
    profiler.begin('shadow');
    try {
      return shadowRender.apply(this, args);
    } finally {
      profiler.end();
    }
  };
  restores.push(() => {
    shadowMap.render = shadowRender;
  });

  // Per-object spans: every rendered Mesh/InstancedMesh/Points/Line is
  // wrapped in onBeforeRender/onAfterRender. The layer id is resolved by
  // ancestor walk once and cached. Note: WebGLShadowMap draws via
  // renderBufferDirect without firing onBeforeRender, so shadow draws do
  // not produce per-object labels — they stay inside the 'shadow' span.
  let wrappedObjects = new WeakSet<THREE.Object3D>();
  const layerIds = new WeakMap<THREE.Object3D, string>();
  const objectRestores: ObjectRestore[] = [];
  function pruneDeadObjectRestores(): void {
    if (objectRestores.length <= 256) {
      return;
    }
    let write = 0;
    for (let i = 0; i < objectRestores.length; i += 1) {
      const entry = objectRestores[i];
      if (entry !== undefined && entry.ref.deref() !== undefined) {
        objectRestores[write] = entry;
        write += 1;
      }
    }
    objectRestores.length = write;
  }
  function wrapObject(object: THREE.Object3D): void {
    wrappedObjects.add(object);
    let layerId = layerIds.get(object);
    if (layerId === undefined) {
      layerId = resolveSceneLayerId(object);
      layerIds.set(object, layerId);
    }
    const material = (object as { material?: MaterialLike | MaterialLike[] }).material ?? null;
    const label = `${layerId}/${materialLabel(material)}`;
    const originalBefore: THREE.Object3D['onBeforeRender'] = Reflect.get(object, 'onBeforeRender');
    const originalAfter: THREE.Object3D['onAfterRender'] = Reflect.get(object, 'onAfterRender');
    object.onBeforeRender = function (
      this: THREE.Object3D,
      ...args: Parameters<THREE.Object3D['onBeforeRender']>
    ) {
      profiler.begin(label);
      originalBefore.apply(this, args);
    };
    object.onAfterRender = function (
      this: THREE.Object3D,
      ...args: Parameters<THREE.Object3D['onAfterRender']>
    ) {
      try {
        originalAfter.apply(this, args);
      } finally {
        profiler.end();
      }
    };
    objectRestores.push({
      ref: new WeakRef(object),
      before: originalBefore,
      after: originalAfter,
    });
  }
  function ensureObjectsWrapped(): void {
    pruneDeadObjectRestores();
    scene.traverse((object) => {
      if (isDrawable(object) && !wrappedObjects.has(object)) {
        wrapObject(object);
      }
    });
  }
  function restoreObjects(): void {
    for (const entry of objectRestores) {
      const obj = entry.ref.deref();
      if (obj !== undefined) {
        obj.onBeforeRender = entry.before;
        obj.onAfterRender = entry.after;
      }
    }
    objectRestores.length = 0;
    wrappedObjects = new WeakSet<THREE.Object3D>();
  }
  if (perObjectEnabled) {
    ensureObjectsWrapped();
  }

  // Passes and effects can be recreated when the debug toggles rebuild
  // the composer children, so wrapping is re-checked every frame.
  const wrappedPasses = new WeakSet<Pass>();
  const wrappedEffects = new WeakSet<Effect>();
  function ensureWrapped(): void {
    const composer = getComposer();
    if (composer == null) {
      return;
    }
    for (const pass of composer.passes) {
      if (!wrappedPasses.has(pass)) {
        wrappedPasses.add(pass);
        const original: Pass['render'] = Reflect.get(pass, 'render');
        const label = passLabel(pass);
        const wrapped: Pass['render'] = function (this: Pass, ...args) {
          profiler.begin(label);
          try {
            original.apply(this, args);
          } finally {
            profiler.end();
          }
        };
        pass.render = wrapped;
        restores.push(() => {
          pass.render = original;
        });
      }
      if (pass instanceof EffectPass) {
        const effects = (pass as unknown as { effects: Effect[] }).effects;
        for (const effect of effects) {
          if (wrappedEffects.has(effect)) {
            continue;
          }
          wrappedEffects.add(effect);
          const original: Effect['update'] = Reflect.get(effect, 'update');
          const label = `fx:${effect.name !== '' ? effect.name : effect.constructor.name}`;
          const wrapped: Effect['update'] = function (this: Effect, ...args) {
            profiler.begin(label);
            try {
              original.apply(this, args);
            } finally {
              profiler.end();
            }
          };
          effect.update = wrapped;
          restores.push(() => {
            effect.update = original;
          });
        }
      }
    }
  }
  ensureWrapped();

  return {
    profiler,
    beginFrame() {
      if (!installed) {
        return;
      }
      info.reset();
      profiler.beginFrame();
    },
    endFrame() {
      if (!installed) {
        return;
      }
      ensureWrapped();
      if (perObjectEnabled) {
        ensureObjectsWrapped();
      }
      profiler.endFrame();
    },
    setPerObject(enabled: boolean) {
      if (!installed || enabled === perObjectEnabled) {
        return;
      }
      perObjectEnabled = enabled;
      if (enabled) {
        ensureObjectsWrapped();
      } else {
        restoreObjects();
      }
      profiler.resetHistory();
    },
    uninstall() {
      if (!installed) {
        return;
      }
      installed = false;
      restoreObjects();
      for (const restore of restores) {
        restore();
      }
      restores.length = 0;
      profiler.dispose();
    },
  };
}
