import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useBoxStore } from '../client/box-store';
import { useInteractionStore, type PrimaryMode } from '../client/interaction-store';
import { useIntentRouter } from '../client/intent';
import { formatClock } from '../client/match-info';
import { useRuntimeStore } from '../client/runtime-store';
import { useSelectionStore } from '../client/selection-store';
import type { SimClient } from '../client/sim-client';
import { useUiStore } from '../client/ui-store';
import { subscribeSnapshotClock } from '../client/use-snapshot';
import { localName, type ContentDb, type ResolvedMap } from '../content/index';
import { COMMAND_REJECTED } from '../core/index';
import { BuildMenu } from '../features/construction/ui/index';
import { RoadPanel, StockPanel } from '../features/logistics/ui/index';
import { SquadsChannel, type SquadsSnapshot } from '../features/squads/protocol';
import { bannerThreat } from '../features/squads/render/index';
import { SquadPanel } from '../features/squads/ui/index';
import { HudShell } from './HudShell';
import styles from './HudShell.module.css';
import { KeyGuideRail } from './KeyGuideRail';
import { TopLeftPod } from './TopLeftPod';
import { InspectorPanel } from './inspector/InspectorPanel';
import { Minimap } from './minimap/Minimap';
import {
  ActionButton,
  SegmentedTabs,
  TacticalPanel,
  ToastStack,
  type ToastItem,
} from './kit/index';

const PRIMARY_MODES: readonly { mode: PrimaryMode; keyLabel: string }[] = [
  { mode: 'command', keyLabel: 'F1' },
  { mode: 'build', keyLabel: 'F2' },
  { mode: 'logistics', keyLabel: 'F3' },
];

const TOAST_MS = 3000;
const MAX_TOASTS = 4;
const KBD_ESC = 'Esc';

function defaultIsHostile(observer: number, faction: number): boolean {
  return faction !== 0 && faction !== observer;
}

export function Hud({
  client,
  db,
  map,
  isHostile,
  modeUi,
  debugUi,
}: {
  client: SimClient;
  db: ContentDb;
  map?: ResolvedMap | null | undefined;
  isHostile?: ((observer: number, faction: number) => boolean) | undefined;
  modeUi?: ReactNode | undefined;
  debugUi?: ReactNode | undefined;
}) {
  const { t } = useTranslation();
  const router = useIntentRouter();
  const workerError = useRuntimeStore((s) => s.error);
  const primaryMode = useInteractionStore((s) => s.mode);
  const tool = useInteractionStore((s) => s.tool);
  const ghost = useInteractionStore((s) => s.ghost);
  const demolishConfirm = useInteractionStore((s) => s.demolishConfirm);
  const selected = useSelectionStore((s) => s.selected);
  const logisticsOverlay = useUiStore((s) => s.logisticsOverlay);
  const box = useBoxStore((s) => s.box);

  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [threat, setThreat] = useState<{ count: number; ticksLeft: number } | null>(null);
  const toastSeq = useRef(0);
  const toastTimers = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());

  const pushToast = useCallback((tone: ToastItem['tone'], text: string) => {
    toastSeq.current += 1;
    const id = `toast-${toastSeq.current}`;
    setToasts((cur) => [...cur.slice(-(MAX_TOASTS - 1)), { id, tone, text }]);
    const timer = setTimeout(() => {
      toastTimers.current.delete(timer);
      setToasts((cur) => cur.filter((item) => item.id !== id));
    }, TOAST_MS);
    toastTimers.current.add(timer);
  }, []);

  useEffect(() => {
    const timers = toastTimers.current;
    return () => {
      for (const timer of timers) {
        clearTimeout(timer);
      }
      timers.clear();
    };
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
          pushToast(
            'danger',
            t('hud.rejected', {
              reason: t(`reason.${reason}`, {
                defaultValue: t('hud.reject_reason.other'),
              }),
            }),
          );
        }
      }
      if (latest === null) {
        return;
      }
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
  }, [client, pushToast, t]);

  const handleDisplayMessage = useCallback(
    (msg: string) => {
      pushToast('warn', msg);
    },
    [pushToast],
  );

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

  const topLeft = (
    <>
      <TopLeftPod client={client} onDisplayMessage={handleDisplayMessage} />
      <ToastStack workerError={workerError} errorPrefix={t('dev.error')} items={toasts} />
    </>
  );

  const topCenter = (
    <>
      {threat !== null && (
        <TacticalPanel tone="danger" compact>
          <span className={styles['bannerTextDanger']}>
            {t('hud.threat', { count: threat.count, time: formatClock(threat.ticksLeft) })}
          </span>
        </TacticalPanel>
      )}
      {demolishConfirm !== null ? (
        <TacticalPanel tone="danger" compact>
          <div className={styles['bannerRow']}>
            <span className={styles['bannerTextDanger']}>
              {t('hud.demolish_confirm_prompt', { count: demolishConfirm.targets.length })}
            </span>
            <ActionButton
              size="sm"
              variant="danger"
              onClick={() => {
                router.dispatch({ kind: 'demolish.confirm' });
              }}
            >
              {t('hud.demolish_confirm_btn')}
            </ActionButton>
            <ActionButton
              size="sm"
              variant="ghost"
              onClick={() => {
                useInteractionStore.getState().clearDemolishConfirm();
              }}
            >
              {t('hud.demolish_cancel_btn')}
            </ActionButton>
          </div>
        </TacticalPanel>
      ) : (
        toolBannerText !== null && (
          <TacticalPanel tone="mode" compact>
            <div className={styles['bannerRow']}>
              <span className={styles['bannerTextInfo']}>{toolBannerText}</span>
              <ActionButton
                size="sm"
                variant="ghost"
                kbd={KBD_ESC}
                onClick={() => {
                  router.dispatch({ kind: 'tool.exit' });
                }}
              >
                {t('hud.tool.exit')}
              </ActionButton>
            </div>
          </TacticalPanel>
        )
      )}
      {tool.kind === 'place' && ghost !== null && ghost.code !== 'ok' && (
        <TacticalPanel tone="warn" compact>
          <span className={styles['bannerTextWarn']}>
            {t(`reason.${ghost.code}`, { defaultValue: ghost.code })}
          </span>
        </TacticalPanel>
      )}
    </>
  );

  const topRight = (
    <>
      <StockPanel client={client} db={db} />
      {debugUi}
    </>
  );

  const bottomLeft = (
    <>
      {map !== null && map !== undefined && (
        <Minimap client={client} db={db} map={map} isHostile={isHostile ?? defaultIsHostile} />
      )}
      <TacticalPanel tone="mode" compact>
        <div className={styles['bottomLeftBar']}>
          <SegmentedTabs
            size="sm"
            ariaLabel={t('hud.mode_switcher')}
            value={primaryMode}
            items={PRIMARY_MODES.map(({ mode, keyLabel }) => ({
              value: mode,
              label: t(`hud.mode.${mode}`),
              kbd: keyLabel,
            }))}
            onChange={(mode) => {
              router.dispatch({ kind: 'mode.select', mode });
            }}
          />
          <ActionButton
            size="sm"
            kbd="L"
            variant={logisticsOverlay ? 'active' : 'default'}
            aria-pressed={logisticsOverlay}
            onClick={() => {
              router.dispatch({ kind: 'overlay.toggle_logistics' });
            }}
          >
            {t('hud.logistics_layer')}
          </ActionButton>
          <span className={styles['selectionBadge']}>
            {t('hud.selected', { count: selected.size })}
          </span>
        </div>
      </TacticalPanel>
    </>
  );

  const bottomCenter = (
    <>
      <SquadPanel client={client} />
      <BuildMenu db={db} />
      <RoadPanel client={client} db={db} />
    </>
  );

  return (
    <>
      <HudShell
        primaryMode={primaryMode}
        topLeft={topLeft}
        topCenter={topCenter}
        topRight={topRight}
        middleLeft={<KeyGuideRail />}
        bottomLeft={bottomLeft}
        bottomCenter={bottomCenter}
        bottomRight={<InspectorPanel client={client} db={db} map={map} isHostile={isHostile} />}
      />
      {modeUi}
      {box !== null && (
        <div
          className={styles['marqueeBox']}
          style={{
            left: box.x0,
            top: box.y0,
            width: box.x1 - box.x0,
            height: box.y1 - box.y0,
          }}
        />
      )}
    </>
  );
}
