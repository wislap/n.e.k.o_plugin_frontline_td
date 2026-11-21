// Game HUD (ADR 0048): pause/speed + camera mode & lock (top-left),
// primary mode bar F1/F2/F3, active secondary tool / demolish-confirm
// banner, selection count / entity panel (bottom-left), build menu /
// road bar (bottom-centre), stock panel (top-right), key hints + ?
// keymap help overlay (bottom-right), drag-box overlay, and 3-second
// command-rejection toast.
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useBoxStore } from '../client/box-store';
import { useCameraStore } from '../client/camera-store';
import { useInteractionStore, type PrimaryMode } from '../client/interaction-store';
import { useIntentRouter } from '../client/intent';
import { formatClock } from '../client/match-info';
import { useRuntimeStore } from '../client/runtime-store';
import { useSelectionStore } from '../client/selection-store';
import type { SimClient } from '../client/sim-client';
import { useUiStore } from '../client/ui-store';
import { subscribeSnapshotClock } from '../client/use-snapshot';
import { localName, type ContentDb } from '../content/index';
import { COMMAND_REJECTED } from '../core/index';
import { BuildMenu } from '../features/construction/ui/index';
import { RoadPanel, StockPanel } from '../features/logistics/ui/index';
import { SquadsChannel, type SquadsSnapshot } from '../features/squads/protocol';
import { bannerThreat } from '../features/squads/render/index';
import { SquadPanel } from '../features/squads/ui/index';
import {
  displayState,
  exitDisplayMode,
  onDisplayStateChange,
  requestDisplayMode,
  type DisplayState,
} from '../host/display';
import { KEYBINDING_GROUPS } from '../input/keymap';
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

const smallBtn = {
  cursor: 'pointer',
  padding: '2px 6px',
  fontFamily: 'monospace',
  fontSize: 11,
  background: 'rgba(30,30,30,0.9)',
  color: '#fff',
  border: '1px solid #555',
  borderRadius: 3,
} as const;

const PRIMARY_MODES: readonly { mode: PrimaryMode; keyLabel: string }[] = [
  { mode: 'command', keyLabel: 'F1' },
  { mode: 'build', keyLabel: 'F2' },
  { mode: 'logistics', keyLabel: 'F3' },
];

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
  const router = useIntentRouter();
  const stats = useRuntimeStore((s) => s.stats);
  const cameraMode = useCameraStore((s) => s.mode);
  const cameraLocked = useCameraStore((s) => s.locked);
  const primaryMode = useInteractionStore((s) => s.mode);
  const tool = useInteractionStore((s) => s.tool);
  const ghost = useInteractionStore((s) => s.ghost);
  const demolishConfirm = useInteractionStore((s) => s.demolishConfirm);
  const selected = useSelectionStore((s) => s.selected);
  const box = useBoxStore((s) => s.box);
  const keymapHelpOpen = useUiStore((s) => s.keymapHelpOpen);
  const [toast, setToast] = useState<{ reason: string; tick: number } | null>(null);
  const [display, setDisplay] = useState<DisplayState>(() => displayState());
  const [displayMsg, setDisplayMsg] = useState<string | null>(null);
  const [threat, setThreat] = useState<{ count: number; ticksLeft: number } | null>(null);

  // Track the host display state; the SDK is absent under Vite dev, in
  // which case supportedModes is empty and the button stays disabled.
  useEffect(() => {
    return onDisplayStateChange(setDisplay);
  }, []);

  // Poll the client event log and director threat on the shared 100 ms clock.
  useEffect(() => {
    let cursor = 0;
    return subscribeSnapshotClock(client, 100, () => {
      const delivered = client.eventsSince(cursor);
      cursor = delivered.cursor;
      const latest = client.snapshots().latest;
      for (const event of delivered.events) {
        if (event.type === COMMAND_REJECTED.type) {
          const reason = (event.payload as { reason?: string }).reason ?? 'unknown';
          const at = latest?.tick ?? 0;
          setToast({ reason, tick: at });
          setTimeout(() => {
            setToast((cur) => (cur !== null && cur.tick === at ? null : cur));
          }, TOAST_MS);
        }
      }
      if (latest === null) {
        return;
      }
      // Director gather warning (M4): visible while any hostile squad is gathering.
      const squads =
        (latest.channels[SquadsChannel.id] as SquadsSnapshot | undefined)?.squads ?? [];
      const nextThreat = bannerThreat(squads, latest.observer, latest.tick);
      setThreat((cur) => {
        if (cur === null && nextThreat === null) {
          return cur;
        }
        if (
          cur !== null &&
          nextThreat !== null &&
          cur.count === nextThreat.count &&
          cur.ticksLeft === nextThreat.ticksLeft
        ) {
          return cur;
        }
        return nextThreat;
      });
    });
  }, [client]);

  const speed = stats !== null ? SPEED_STEPS[stats.speedIndex] : undefined;

  const toolBannerText = (() => {
    switch (tool.kind) {
      case 'place': {
        const name = localName(tool.structureKindId);
        return t('hud.tool.place', {
          name: t(`structure.${name}`, { defaultValue: name }),
        });
      }
      case 'demolish':
        return t('hud.tool.demolish');
      case 'road':
        return t('hud.tool.road');
      case 'none':
        return null;
    }
  })();

  return (
    <>
      <div
        style={{ ...corner, top: 8, left: 8, pointerEvents: 'auto' }}
        data-sim-tick={stats?.tick ?? -1}
      >
        <div>{stats?.paused === true ? t('hud.paused') : t('hud.speed', { n: speed ?? 1 })}</div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 4 }}>
          <button
            type="button"
            title={t('hud.camera.toggle_hint')}
            onClick={() => {
              router.dispatch({ kind: 'camera.toggle_mode' });
            }}
            style={smallBtn}
          >
            {t(`hud.camera.${cameraMode}`)}
          </button>
          <button
            type="button"
            onClick={() => {
              router.dispatch({ kind: 'camera.toggle_lock' });
            }}
            style={{
              ...smallBtn,
              border: cameraLocked ? '1px solid #ffd166' : '1px solid #555',
              background: cameraLocked ? 'rgba(255,209,102,0.22)' : 'rgba(30,30,30,0.9)',
            }}
          >
            {t(cameraLocked ? 'hud.camera.locked' : 'hud.camera.unlocked')}
          </button>
        </div>
      </div>

      <div
        style={{
          ...corner,
          top: 8,
          left: 228,
          display: 'flex',
          gap: 6,
          pointerEvents: 'auto',
        }}
      >
        {PRIMARY_MODES.map(({ mode, keyLabel }) => {
          const active = primaryMode === mode;
          return (
            <button
              key={mode}
              type="button"
              onClick={() => {
                router.dispatch({ kind: 'mode.select', mode });
              }}
              style={{
                ...smallBtn,
                padding: '3px 8px',
                border: active ? '1px solid #7fd4ff' : '1px solid #555',
                background: active ? 'rgba(127,212,255,0.25)' : 'rgba(30,30,30,0.9)',
              }}
            >
              {`[${keyLabel}] `}
              {t(`hud.mode.${mode}`)}
            </button>
          );
        })}
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

      {(demolishConfirm !== null || toolBannerText !== null) && (
        <div
          style={{
            ...corner,
            bottom: 72,
            left: '50%',
            transform: 'translateX(-50%)',
            display: 'flex',
            gap: 8,
            alignItems: 'center',
            pointerEvents: 'auto',
            border: demolishConfirm !== null ? '1px solid #ff8a7a' : '1px solid #555',
          }}
        >
          {demolishConfirm !== null ? (
            <>
              <span style={{ color: '#ff9a7a' }}>
                {t('hud.demolish_confirm_prompt', { count: demolishConfirm.targets.length })}
              </span>
              <button
                type="button"
                onClick={() => {
                  router.dispatch({ kind: 'demolish.confirm' });
                }}
                style={{
                  ...smallBtn,
                  border: '1px solid #ff8a7a',
                  background: 'rgba(255,138,122,0.28)',
                }}
              >
                {t('hud.demolish_confirm_btn')}
              </button>
              <button
                type="button"
                onClick={() => {
                  useInteractionStore.getState().clearDemolishConfirm();
                }}
                style={smallBtn}
              >
                {t('hud.demolish_cancel_btn')}
              </button>
            </>
          ) : (
            <>
              <span>{toolBannerText}</span>
              <button
                type="button"
                onClick={() => {
                  router.dispatch({ kind: 'tool.exit' });
                }}
                style={smallBtn}
              >
                {t('hud.tool.exit')}
              </button>
            </>
          )}
        </div>
      )}

      <div
        style={{
          ...corner,
          bottom: 8,
          right: 8,
          textAlign: 'right',
          pointerEvents: 'auto',
        }}
      >
        {tool.kind === 'place' && ghost !== null && ghost.code !== 'ok' && (
          <div style={{ color: '#ff9a7a', marginBottom: 2 }}>
            {t(`reason.${ghost.code}`, { defaultValue: ghost.code })}
          </div>
        )}
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'flex-end' }}>
          <span>{t('hud.hints')}</span>
          <button
            type="button"
            title={t('hud.help_button_hint')}
            onClick={() => {
              router.dispatch({ kind: 'ui.toggle_keymap_help' });
            }}
            style={smallBtn}
          >
            {'?'}
          </button>
        </div>
      </div>

      {toast !== null && (
        <div style={{ ...corner, top: 76, left: 8, color: '#ff9a7a' }}>
          {t('hud.rejected', {
            reason: t(`reason.${toast.reason}`, {
              defaultValue: t('hud.reject_reason.other'),
            }),
          })}
        </div>
      )}

      {keymapHelpOpen && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.55)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 960,
          }}
          onClick={() => {
            useUiStore.getState().closeKeymapHelp();
          }}
        >
          <div
            style={{
              background: 'rgba(15,20,30,0.96)',
              border: '1px solid #555',
              borderRadius: 6,
              padding: '14px 18px',
              color: '#fff',
              fontFamily: 'monospace',
              fontSize: 12,
              maxWidth: 680,
              width: '90%',
            }}
            onClick={(e) => {
              e.stopPropagation();
            }}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: 10,
                borderBottom: '1px solid #444',
                paddingBottom: 6,
              }}
            >
              <b>{t('help.title')}</b>
              <button
                type="button"
                onClick={() => {
                  useUiStore.getState().closeKeymapHelp();
                }}
                style={smallBtn}
              >
                {t('help.close')}
              </button>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
              {KEYBINDING_GROUPS.map((group) => (
                <div key={group.titleKey}>
                  <div style={{ color: '#7fd4ff', marginBottom: 4, fontWeight: 'bold' }}>
                    {t(group.titleKey, { defaultValue: group.titleKey })}
                  </div>
                  {group.entries.map((entry) => (
                    <div
                      key={`${group.titleKey}:${entry.keys}`}
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        gap: 8,
                        marginBottom: 2,
                      }}
                    >
                      <span style={{ color: '#ffd166' }}>{entry.keys}</span>
                      <span>{t(entry.descKey, { defaultValue: entry.descKey })}</span>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>
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
