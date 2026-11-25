// Shared handle to the mounted postprocessing EffectComposer so the dev
// GPU instrumentation (PerfProbe) can wrap its passes without prop
// drilling through PostEffects.
import type { EffectComposer } from 'postprocessing';

export const effectComposerRef: { current: EffectComposer | null } = { current: null };

export function setEffectComposer(composer: EffectComposer | null): void {
  effectComposerRef.current = composer;
  // Exposed for owner measurement scripts scraping the live preview.
  (globalThis as { __ftdComposer?: EffectComposer | null }).__ftdComposer = composer;
}
