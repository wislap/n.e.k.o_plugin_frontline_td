// GPU instrumentation installer (dev DebugPanel only): wraps the
// shadow-map render, every composer pass, and every effect's update
// (bloom mip blur / SMAA edges live there) with profiler spans, and
// takes over gl.info resets so the counters reflect a whole frame.
// Install/uninstall is driven by the PerfProbe mount while the panel is
// open; everything is restored on uninstall.
import type * as THREE from 'three';
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

export function installGpuInstrumentation(
  renderer: THREE.WebGLRenderer,
  getComposer: () => EffectComposer | null,
): GpuInstrumentation {
  const profiler = GpuProfiler.fromContext(renderer.getContext() as WebGL2RenderingContext);
  const restores: Array<() => void> = [];
  let installed = true;

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

  // Passes and effects can be recreated when the debug toggles rebuild
  // the composer children, so wrapping is re-checked every frame.
  const wrappedPasses = new WeakSet<Pass>();
  const wrappedEffects = new WeakSet<Effect>();
  function ensureWrapped(): void {
    const composer = getComposer();
    if (composer === null) {
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
      profiler.endFrame();
    },
    uninstall() {
      if (!installed) {
        return;
      }
      installed = false;
      for (const restore of restores) {
        restore();
      }
      restores.length = 0;
    },
  };
}
