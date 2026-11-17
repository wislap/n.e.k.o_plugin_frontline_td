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
import { RoadPanel, StockPanel } from '../features/logistics/ui/index';
import { SquadsChannel, type SquadsSnapshot } from '../features/squads/protocol';
import { bannerThreat } from '../features/squads/render/index';
import { SquadPanel } from '../features/squads/ui/index';
import { formatClock } from '../client/match-info';
import {
  displayState,
  exitDisplayMode,
  onDisplayStateChange,
  requestDisplayMode,
  type DisplayState,
} from '../host/display';
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

export function Hud({
  client,
  db,
  modeUi,
}: {
  client: SimClient;
  db: ContentDb;
  // Mode-provided overlay content (e.g. the assault end screen); the
  // generic HUD never reads mode channels itself.
  modeUi?: React.ReactNode;
}) {
  const { t } = useTranslation();
  const stats = useRuntimeStore((s) => s.stats);
  const mode = useCameraStore((s) => s.mode);
  const selected = useSelectionStore((s) => s.selected);
  const box = useBoxStore((s) => s.box);
  const buildKind = useBuildStore((s) => s.kind);
  const ghost = useBuildStore((s) => s.ghost);
  const [toast, setToast] = useState<{ reason: string; tick: number } | null>(null);
  const [display, setDisplay] = useState<DisplayState>(() => displayState());
  const [displayMsg, setDisplayMsg] = useState<string | null>(null);
  const [threat, setThreat] = useState<{ count: number; ticksLeft: number } | null>(null);

  // Track the host display state; the SDK is absent under Vite dev, in
  // which case supportedModes is empty and the button stays disabled.
  useEffect(() => {
    return onDisplayStateChange(setDisplay);
  }, []);

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
      // Director gather warning (M4): visible while any hostile squad
      // is gathering.
      const squads =
        (latest.channels[SquadsChannel.id] as SquadsSnapshot | undefined)?.squads ?? [];
      setThreat(bannerThreat(squads, latest.observer, latest.tick));
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
      <SquadPanel client={client} />
      {modeUi}
      <BuildMenu db={db} />
      <StockPanel client={client} db={db} />
      <RoadPanel client={client} db={db} />
      <button
        type="button"
        disabled={!display.supportedModes.includes('fullscreen')}
        title={
          display.supportedModes.includes('fullscreen')
            ? t('hud.fullscreen')
            : t('hud.fullscreen_unsupported')
        }
        onClick={() => {
          const op =
            display.mode === 'fullscreen' ? exitDisplayMode() : requestDisplayMode('fullscreen');
          void op.then((result) => {
            if (result.status !== 'applied' && result.status !== 'cancelled') {
              setDisplayMsg(t(`hud.display.${result.status}`, { defaultValue: result.status }));
              setTimeout(() => {
                setDisplayMsg(null);
              }, TOAST_MS);
            }
          });
        }}
        style={{
          position: 'fixed',
          top: 8,
          left: '50%',
          transform: 'translateX(-50%)',
          padding: '3px 10px',
          background: 'rgba(0,0,0,0.55)',
          color: display.supportedModes.includes('fullscreen') ? '#fff' : '#777',
          fontFamily: 'monospace',
          fontSize: 12,
          zIndex: 900,
          border: '1px solid #555',
          borderRadius: 4,
          cursor: display.supportedModes.includes('fullscreen') ? 'pointer' : 'default',
        }}
      >
        {t('hud.fullscreen')}
      </button>
      {threat !== null && (
        <div
          style={{
            ...corner,
            top: 40,
            left: '50%',
            transform: 'translateX(-50%)',
            color: '#ff8a7a',
            fontWeight: 'bold',
          }}
        >
          {t('hud.threat', { count: threat.count, time: formatClock(threat.ticksLeft) })}
        </div>
      )}
      {displayMsg !== null && (
        <div style={{ ...corner, top: 40, left: '50%', transform: 'translateX(-50%)' }}>
          {displayMsg}
        </div>
      )}
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
