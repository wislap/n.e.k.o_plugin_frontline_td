/**
 * Shared Chromium GPU selection for shots and e2e.
 *
 * Locally on Windows the default headless SwiftShader renders at ~1fps,
 * which dominates every capture/test budget. Requesting ANGLE/D3D11
 * gives real-GPU rendering (~60fps+). CI has no GPU, so the override is
 * gated on win32 + no CI env; FTD_GL=software forces SwiftShader for
 * local A/B or debugging.
 */
export function chromiumGlArgs(): string[] {
  if (process.env['FTD_GL'] === 'software') {
    return [];
  }
  if (process.platform === 'win32' && process.env['CI'] === undefined) {
    return ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'];
  }
  return [];
}
