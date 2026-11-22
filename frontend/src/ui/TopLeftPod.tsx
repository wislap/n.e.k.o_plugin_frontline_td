import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { compassHeadingDeg } from '../client/camera-math';
import { useCameraStore } from '../client/camera-store';
import { useIntentRouter } from '../client/intent';
import { formatClock } from '../client/match-info';
import { useRuntimeStore } from '../client/runtime-store';
import type { SimClient } from '../client/sim-client';
import {
  displayState,
  exitDisplayMode,
  onDisplayStateChange,
  requestDisplayMode,
  type DisplayState,
} from '../host/display';
import { SPEED_STEPS } from '../protocol/index';
import { ActionButton, cx, SegmentedTabs, TacticalPanel } from './kit/index';
import styles from './TopLeftPod.module.css';

const SPEED_OPTIONS = SPEED_STEPS.filter((n) => n > 0);
const KBD_SPACE = 'Space';
const KBD_TAB = 'Tab';

export function TopLeftPod({
  client,
  onDisplayMessage,
}: {
  client: SimClient;
  onDisplayMessage: (msg: string) => void;
}) {
  const { t } = useTranslation();
  const router = useIntentRouter();
  const stats = useRuntimeStore((s) => s.stats);
  const cameraMode = useCameraStore((s) => s.mode);
  const cameraLocked = useCameraStore((s) => s.locked);
  const yawDeg = useCameraStore((s) => compassHeadingDeg(s.yaw));
  const [display, setDisplay] = useState<DisplayState>(() => displayState());

  // Track the host display state; the SDK is absent under Vite dev, in
  // which case supportedModes is empty and the button stays disabled.
  useEffect(() => {
    return onDisplayStateChange(setDisplay);
  }, []);

  const tick = stats?.tick ?? -1;
  const paused = stats?.paused === true;
  const speedValue = paused ? '0' : String(stats?.speedIndex ?? 1);
  const fullscreenSupported = display.supportedModes.includes('fullscreen');

  return (
    <div className={styles['root']} data-sim-tick={tick}>
      <TacticalPanel tone="neutral" compact bodyClassName={styles['body']}>
        <div className={styles['row']}>
          <div className={styles['clockPill']}>
            <span className={cx(styles['dot'], paused && styles['dotPaused'])} />
            <span className={styles['clockTime']}>{formatClock(Math.max(0, tick))}</span>
            <span className={styles['clockTick']}>
              {t('hud.clock_tick', { tick: Math.max(0, tick) })}
            </span>
          </div>
          <ActionButton
            size="sm"
            kbd={KBD_SPACE}
            variant={paused ? 'primary' : 'default'}
            onClick={() => {
              router.dispatch({ kind: 'runtime.toggle_pause' });
            }}
          >
            {t(paused ? 'dev.resume' : 'dev.pause')}
          </ActionButton>
          <SegmentedTabs
            size="sm"
            ariaLabel={t('dev.speed')}
            value={speedValue}
            items={SPEED_OPTIONS.map((step) => ({
              value: String(step),
              label: t('dev.speed_value', { n: step }),
            }))}
            onChange={(val) => {
              client.setSpeedIndex(Number(val));
            }}
          />
        </div>

        <div className={styles['row']}>
          <ActionButton
            size="sm"
            kbd={KBD_TAB}
            title={t('hud.camera.toggle_hint')}
            onClick={() => {
              router.dispatch({ kind: 'camera.toggle_mode' });
            }}
          >
            {t(`hud.camera.${cameraMode}`)}
          </ActionButton>
          <ActionButton
            size="sm"
            variant={cameraLocked ? 'active' : 'default'}
            aria-pressed={cameraLocked}
            onClick={() => {
              router.dispatch({ kind: 'camera.toggle_lock' });
            }}
          >
            {t(cameraLocked ? 'hud.camera.locked' : 'hud.camera.unlocked')}
          </ActionButton>
          <button
            type="button"
            className={cx(styles['compassBtn'], yawDeg !== 0 && styles['compassRotated'])}
            data-testid="camera-compass"
            data-compass-deg={yawDeg}
            aria-label={t('hud.camera.reset_north')}
            title={t('hud.camera.reset_north_hint')}
            onClick={() => {
              router.dispatch({ kind: 'camera.reset_orientation' });
            }}
          >
            <svg
              className={styles['compassIcon']}
              viewBox="0 0 16 16"
              aria-hidden="true"
              style={{ transform: `rotate(${-yawDeg}deg)` }}
            >
              <polygon points="8,1 11,8 8,7 5,8" fill="currentColor" />
              <polygon points="8,15 11,8 8,9 5,8" fill="currentColor" opacity="0.35" />
            </svg>
            <span className={styles['compassLabel']}>{t('hud.camera.compass_n')}</span>
          </button>
          <ActionButton
            size="sm"
            variant={display.mode === 'fullscreen' ? 'active' : 'default'}
            disabled={!fullscreenSupported}
            title={t(fullscreenSupported ? 'hud.fullscreen' : 'hud.fullscreen_unsupported')}
            onClick={() => {
              const op =
                display.mode === 'fullscreen'
                  ? exitDisplayMode()
                  : requestDisplayMode('fullscreen');
              void op.then((result) => {
                if (result.status !== 'applied' && result.status !== 'cancelled') {
                  onDisplayMessage(
                    t(`hud.display.${result.status}`, { defaultValue: result.status }),
                  );
                }
              });
            }}
          >
            {t('hud.fullscreen')}
          </ActionButton>
        </div>
      </TacticalPanel>
    </div>
  );
}
