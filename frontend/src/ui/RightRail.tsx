// Right-edge tool rail (visual-languages HUD): vertically centered round
// icon buttons for the existing secondary view controls — camera mode
// (Tab), camera lock, north reset, fullscreen, logistics overlay (L) and
// the key guide (K). Re-houses the old TopLeftPod second row; no new
// functionality. The .lbl captions are hidden in the legacy skin and
// shown left of the button in the field skin.
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { compassHeadingDeg } from '../client/camera-math';
import { useCameraStore } from '../client/camera-store';
import { useIntentRouter } from '../client/intent';
import { useUiStore } from '../client/ui-store';
import {
  displayState,
  exitDisplayMode,
  onDisplayStateChange,
  requestDisplayMode,
  type DisplayState,
} from '../host/display';
import {
  IconCompass,
  IconFullscreen,
  IconKeycap,
  IconLink,
  IconLock,
  IconRadar,
  IconView,
} from './icons';
import { cx, Kbd } from './kit/index';
import styles from './RightRail.module.css';

const KBD_TAB = 'Tab';
const KBD_L = 'L';
const KBD_K = 'K';

export function RightRail({ onDisplayMessage }: { onDisplayMessage: (msg: string) => void }) {
  const { t } = useTranslation();
  const router = useIntentRouter();
  const cameraMode = useCameraStore((s) => s.mode);
  const cameraLocked = useCameraStore((s) => s.locked);
  const yawDeg = useCameraStore((s) => compassHeadingDeg(s.yaw));
  const logisticsOverlay = useUiStore((s) => s.logisticsOverlay);
  const minimapOpen = useUiStore((s) => s.minimapOpen);
  const keymapOpen = useUiStore((s) => s.keymapHelpOpen);
  const [display, setDisplay] = useState<DisplayState>(() => displayState());

  useEffect(() => {
    return onDisplayStateChange(setDisplay);
  }, []);

  const fullscreenSupported = display.supportedModes.includes('fullscreen');

  return (
    <div className={styles['rail']}>
      <div className={styles['item']}>
        <span className={styles['lbl']}>
          {t(`hud.camera.${cameraMode}`)} <Kbd>{KBD_TAB}</Kbd>
        </span>
        <button
          type="button"
          className={styles['btn']}
          aria-label={t(`hud.camera.${cameraMode}`)}
          title={`${t(`hud.camera.${cameraMode}`)} (Tab)`}
          onClick={() => {
            router.dispatch({ kind: 'camera.toggle_mode' });
          }}
        >
          <IconView />
          <span className={styles['cap']}>{t('hud.camera.toggle_hint')}</span>
        </button>
      </div>
      <div className={styles['item']}>
        <span className={styles['lbl']}>
          {t(cameraLocked ? 'hud.camera.locked' : 'hud.camera.unlocked')}
        </span>
        <button
          type="button"
          className={cx(styles['btn'], cameraLocked && styles['btnActive'])}
          aria-pressed={cameraLocked}
          aria-label={t(cameraLocked ? 'hud.camera.locked' : 'hud.camera.unlocked')}
          title={t(cameraLocked ? 'hud.camera.locked' : 'hud.camera.unlocked')}
          onClick={() => {
            router.dispatch({ kind: 'camera.toggle_lock' });
          }}
        >
          <IconLock locked={cameraLocked} />
        </button>
      </div>
      <div className={styles['item']}>
        <span className={styles['lbl']}>{t('hud.camera.reset_north')}</span>
        <button
          type="button"
          className={styles['btn']}
          data-testid="camera-compass"
          data-compass-deg={yawDeg}
          aria-label={t('hud.camera.reset_north')}
          title={t('hud.camera.reset_north_hint')}
          onClick={() => {
            router.dispatch({ kind: 'camera.reset_orientation' });
          }}
        >
          <span style={{ transform: `rotate(${-yawDeg}deg)`, display: 'inline-flex' }}>
            <IconCompass />
          </span>
          <span className={styles['cap']}>{t('hud.camera.compass_n')}</span>
        </button>
      </div>
      <div className={styles['item']}>
        <span className={styles['lbl']}>{t('hud.fullscreen')}</span>
        <button
          type="button"
          className={cx(styles['btn'], display.mode === 'fullscreen' && styles['btnActive'])}
          disabled={!fullscreenSupported}
          aria-label={t('hud.fullscreen')}
          title={t(fullscreenSupported ? 'hud.fullscreen' : 'hud.fullscreen_unsupported')}
          onClick={() => {
            const op =
              display.mode === 'fullscreen' ? exitDisplayMode() : requestDisplayMode('fullscreen');
            void op.then((result) => {
              if (result.status !== 'applied' && result.status !== 'cancelled') {
                onDisplayMessage(
                  t(`hud.display.${result.status}`, { defaultValue: result.status }),
                );
              }
            });
          }}
        >
          <IconFullscreen />
        </button>
      </div>
      <div className={styles['item']}>
        <span className={styles['lbl']}>{t('hud.minimap_toggle')}</span>
        <button
          type="button"
          className={cx(styles['btn'], minimapOpen && styles['btnActive'])}
          aria-pressed={minimapOpen}
          aria-label={t('hud.minimap_toggle')}
          title={t('hud.minimap_toggle')}
          onClick={() => {
            useUiStore.getState().toggleMinimap();
          }}
        >
          <IconRadar />
        </button>
      </div>
      <div className={styles['item']}>
        <span className={styles['lbl']}>
          {t('hud.logistics_layer')} <Kbd>{KBD_L}</Kbd>
        </span>
        <button
          type="button"
          className={cx(styles['btn'], logisticsOverlay && styles['btnActive'])}
          aria-pressed={logisticsOverlay}
          aria-label={t('hud.logistics_layer')}
          title={`${t('hud.logistics_layer')} (L)`}
          onClick={() => {
            router.dispatch({ kind: 'overlay.toggle_logistics' });
          }}
        >
          <IconLink />
          <span className={styles['cap']}>L</span>
        </button>
      </div>
      <div className={styles['item']}>
        <span className={styles['lbl']}>
          {t(keymapOpen ? 'hud.guide_collapse' : 'hud.guide_expand')} <Kbd>{KBD_K}</Kbd>
        </span>
        <button
          type="button"
          className={cx(styles['btn'], keymapOpen && styles['btnActive'])}
          aria-pressed={keymapOpen}
          aria-label={t(keymapOpen ? 'hud.guide_collapse' : 'hud.guide_expand')}
          title={t(keymapOpen ? 'hud.guide_collapse' : 'hud.guide_expand')}
          onClick={() => {
            router.dispatch({ kind: 'ui.toggle_keymap_help' });
          }}
        >
          <IconKeycap />
        </button>
      </div>
    </div>
  );
}
