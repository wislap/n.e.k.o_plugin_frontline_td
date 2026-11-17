// Game HUD (M2 C7 + M3 D): pause/speed + camera mode (top-left),
// selection count / entity panel (bottom-left), build menu (bottom
// centre), stock panel (top-right), key hints + ghost reason
// (bottom-right), the drag-box overlay, and a 3-second toast for the
// last command rejection. All text via i18n.
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { COMMAND_REJECTED } from '../core/index';
import { useBoxStore } from '../client/box-store';
import { useBuildStore } from '../client/build-store';
import { useCameraStore } from '../client/camera-store';
import type { SimClient } from '../client/sim-client';
import { useRuntimeStore } from '../client/runtime-store';
import { useSelectionStore } from '../client/selection-store';
import type { ContentDb } from '../content/index';
import { BuildMenu } from '../features/construction/ui/index';
import { StockPanel } from '../features/logistics/ui/index';
import { SPEED_STEPS } from '../protocol/index';
import { EntityPanel } from './EntityPanel';

const corner = {
  position: 'fixed',
  padding: '6px 10px',
  background: 'rgba(0,0,0,0.55)',
  color: '#fff',
  fontFamily: 'monospace',
  fontSize: 12,
  zIndex: 900,
  pointerEvents: 'none',
  borderRadius: 4,
} as const;

const TOAST_MS = 3000;

export function Hud({ client, db }: { client: SimClient; db: ContentDb }) {
  const { t } = useTranslation();
  const stats = useRuntimeStore((s) => s.stats);
  const mode = useCameraStore((s) => s.mode);
  const selected = useSelectionStore((s) => s.selected);
  const box = useBoxStore((s) => s.box);
  const buildKind = useBuildStore((s) => s.kind);
  const ghost = useBuildStore((s) => s.ghost);
  const [toast, setToast] = useState<{ reason: string; tick: number } | null>(null);

  // Poll the observer snapshot for COMMAND_REJECTED events (events are
  // last-tick only, so we snapshot (tick, reason) pairs).
  useEffect(() => {
    let lastTick = -1;
    const id = setInterval(() => {
      const latest = client.snapshots().latest;
      if (latest === null || latest.tick === lastTick) {
        return;
      }
      for (const event of latest.events) {
        if (event.type === COMMAND_REJECTED.type) {
          const reason = (event.payload as { reason?: string }).reason ?? 'unknown';
          lastTick = latest.tick;
          setToast({ reason, tick: latest.tick });
          setTimeout(() => {
            setToast((cur) => (cur !== null && cur.tick === latest.tick ? null : cur));
          }, TOAST_MS);
        }
      }
      lastTick = latest.tick;
    }, 100);
    return () => {
      clearInterval(id);
    };
  }, [client]);

  const speed = stats !== null ? SPEED_STEPS[stats.speedIndex] : undefined;

  return (
    <>
      <div style={{ ...corner, top: 8, left: 8 }}>
        <div>{stats?.paused === true ? t('hud.paused') : t('hud.speed', { n: speed ?? 1 })}</div>
        <div>{t(`hud.camera.${mode}`)}</div>
      </div>
      <div style={{ ...corner, bottom: 8, left: 8 }}>
        {t('hud.selected', { count: selected.size })}
      </div>
      <EntityPanel client={client} db={db} />
      <BuildMenu db={db} />
      <StockPanel client={client} db={db} />
      <div style={{ ...corner, bottom: 8, right: 8, textAlign: 'right' }}>
        {buildKind !== null && ghost !== null && ghost.code !== 'ok' && (
          <div style={{ color: '#ff9a7a' }}>
            {t(`reason.${ghost.code}`, { defaultValue: ghost.code })}
          </div>
        )}
        {t('hud.hints')}
      </div>
      {toast !== null && (
        <div style={{ ...corner, top: 40, left: 8, color: '#ff9a7a' }}>
          {t('hud.rejected', {
            reason: t(`reason.${toast.reason}`, {
              defaultValue: t('hud.reject_reason.other'),
            }),
          })}
        </div>
      )}
      {box !== null && (
        <div
          style={{
            position: 'fixed',
            left: box.x0,
            top: box.y0,
            width: box.x1 - box.x0,
            height: box.y1 - box.y0,
            border: '1px solid #7fd4ff',
            background: 'rgba(127, 212, 255, 0.15)',
            zIndex: 950,
            pointerEvents: 'none',
          }}
        />
      )}
    </>
  );
}
