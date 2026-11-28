// Shell HUD panels (ADR 0062 step 2): shell-owned panels split into
// small components declared as HudPanelDefs; feature panels live under
// features/*/ui. In-slot `order` values reproduce the pre-registry DOM
// order exactly.
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useInteractionStore, type PrimaryMode } from '../client/interaction-store';
import { useIntentRouter } from '../client/intent';
import { useRuntimeStore } from '../client/runtime-store';
import { useSelectionStore } from '../client/selection-store';
import { subscribeSnapshotClock } from '../client/use-snapshot';
import { localName } from '../content/index';
import { COMMAND_REJECTED } from '../core/index';
import { GaugePill } from './GaugePill';
import styles from './HudShell.module.css';
import type { HudPanelDef, HudPanelProps } from './hud-panels';
import { KeyGuideRail } from './KeyGuideRail';
import { RightRail } from './RightRail';
import { ActionButton, SegmentedTabs, TacticalPanel, ToastStack } from './kit/index';
import { useToastStore } from './toast-store';

const PRIMARY_MODES: readonly { mode: PrimaryMode; keyLabel: string }[] = [
  { mode: 'command', keyLabel: 'F1' },
  { mode: 'build', keyLabel: 'F2' },
  { mode: 'logistics', keyLabel: 'F3' },
];

const KBD_ESC = 'Esc';

function ModeTabs() {
  const { t } = useTranslation();
  const router = useIntentRouter();
  const primaryMode = useInteractionStore((s) => s.mode);
  return (
    <TacticalPanel tone="mode" compact>
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
    </TacticalPanel>
  );
}

// Polls the client event log on the coalesced 100 ms snapshot clock and
// turns COMMAND_REJECTED events into danger toasts.
function ToastsPanel({ ctx }: HudPanelProps) {
  const { t } = useTranslation();
  const workerError = useRuntimeStore((s) => s.error);
  const items = useToastStore((s) => s.items);

  useEffect(() => {
    let cursor = 0;
    const unsubRestart = ctx.client.subscribe(() => {
      if (ctx.client.snapshots().latest === null) {
        cursor = 0;
      }
    });
    const drain = (): void => {
      const first = ctx.client.eventsSince(cursor);
      const delivered = first.cursor < cursor ? ctx.client.eventsSince(0) : first;
      cursor = delivered.cursor;
      for (const event of delivered.events) {
        if (event.type === COMMAND_REJECTED.type) {
          const reason = (event.payload as { reason?: string }).reason ?? 'unknown';
          useToastStore.getState().push(
            'danger',
            t('hud.rejected', {
              reason: t(`reason.${reason}`, { defaultValue: t('hud.reject_reason.other') }),
            }),
          );
        }
      }
    };
    drain();
    const unsubClock = subscribeSnapshotClock(ctx.client, 100, drain);
    return () => {
      unsubClock();
      unsubRestart();
    };
  }, [ctx.client, t]);

  return <ToastStack workerError={workerError} errorPrefix={t('dev.error')} items={items} />;
}

function GaugePanel({ ctx }: HudPanelProps) {
  return <GaugePill client={ctx.client} />;
}

// Demolish confirmation (danger) or the active secondary-tool banner
// (mode): mutually exclusive, matching the pre-registry JSX.
function ToolBannerPanel() {
  const { t } = useTranslation();
  const router = useIntentRouter();
  const tool = useInteractionStore((s) => s.tool);
  const demolishConfirm = useInteractionStore((s) => s.demolishConfirm);

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

  if (demolishConfirm !== null) {
    return (
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
    );
  }
  if (toolBannerText === null) {
    return null;
  }
  return (
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
  );
}

function GhostWarnPanel() {
  const { t } = useTranslation();
  const tool = useInteractionStore((s) => s.tool);
  const ghost = useInteractionStore((s) => s.ghost);
  if (tool.kind !== 'place' || ghost === null || ghost.code === 'ok') {
    return null;
  }
  return (
    <TacticalPanel tone="warn" compact>
      <span className={styles['bannerTextWarn']}>
        {t(`reason.${ghost.code}`, { defaultValue: ghost.code })}
      </span>
    </TacticalPanel>
  );
}

function SelectionBadgePanel() {
  const { t } = useTranslation();
  const selected = useSelectionStore((s) => s.selected);
  return (
    <TacticalPanel tone="mode" compact>
      <span className={styles['selectionBadge']}>
        {t('hud.selected', { count: selected.size })}
      </span>
    </TacticalPanel>
  );
}

function KeyGuidePanel() {
  return <KeyGuideRail />;
}

function RightRailPanel() {
  return <RightRail />;
}

export const SHELL_HUD_PANELS: readonly HudPanelDef[] = [
  { id: 'shell.modeTabs', slot: 'topLeft', order: 10, Component: ModeTabs },
  { id: 'shell.toasts', slot: 'topLeft', order: 30, Component: ToastsPanel },
  { id: 'shell.gauge', slot: 'topCenter', order: 10, Component: GaugePanel },
  { id: 'shell.toolBanner', slot: 'topCenter', order: 30, Component: ToolBannerPanel },
  { id: 'shell.ghostWarn', slot: 'topCenter', order: 40, Component: GhostWarnPanel },
  { id: 'shell.selectionBadge', slot: 'bottomLeft', order: 20, Component: SelectionBadgePanel },
  { id: 'shell.keyGuideRail', slot: 'middleLeft', order: 10, Component: KeyGuidePanel },
  { id: 'shell.rightRail', slot: 'middleRight', order: 10, Component: RightRailPanel },
];
