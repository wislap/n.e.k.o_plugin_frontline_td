import { useTranslation } from 'react-i18next';
import { useInteractionStore } from '../client/interaction-store';
import { useIntentRouter } from '../client/intent';
import { useUiStore } from '../client/ui-store';
import { KEYBINDING_GROUPS } from '../input/keymap';
import { ActionButton, cx, Kbd, TacticalPanel } from './kit/index';
import styles from './KeyGuideRail.module.css';

export function KeyGuideRail() {
  const { t } = useTranslation();
  const router = useIntentRouter();
  const open = useUiStore((s) => s.keymapHelpOpen);
  const primaryMode = useInteractionStore((s) => s.mode);

  const toggle = (): void => {
    router.dispatch({ kind: 'ui.toggle_keymap_help' });
  };

  if (!open) {
    return (
      <div className={styles['collapsed']}>
        <ActionButton size="sm" kbd="K" onClick={toggle}>
          {t('hud.guide_expand')}
        </ActionButton>
      </div>
    );
  }

  const modeGroup = KEYBINDING_GROUPS.find((g) => g.mode === primaryMode);
  const globalGroup = KEYBINDING_GROUPS.find((g) => g.mode === undefined);

  return (
    <TacticalPanel
      tone="mode"
      compact
      title={t('hud.guide_title')}
      headerActions={
        <ActionButton size="sm" variant="ghost" kbd="K" onClick={toggle}>
          {t('hud.guide_collapse')}
        </ActionButton>
      }
      className={styles['panel']}
      bodyClassName={styles['body']}
    >
      {modeGroup !== undefined && (
        <div className={cx(styles['section'], styles['modeSection'])}>
          <div className={styles['sectionHeader']}>
            <span className={styles['sectionTitle']}>
              {t(modeGroup.titleKey, { defaultValue: modeGroup.titleKey })}
            </span>
            <span className={styles['sectionTag']}>{t('hud.guide_mode_section')}</span>
          </div>
          {modeGroup.entries.map((entry) => (
            <div key={`${modeGroup.titleKey}:${entry.keys}`} className={styles['entry']}>
              <Kbd active>{entry.keys}</Kbd>
              <span className={styles['desc']}>
                {t(entry.descKey, { defaultValue: entry.descKey })}
              </span>
            </div>
          ))}
        </div>
      )}

      {globalGroup !== undefined && (
        <div className={styles['section']}>
          <div className={styles['globalTitle']}>{t('hud.guide_global_section')}</div>
          {globalGroup.entries.map((entry) => (
            <div key={`${globalGroup.titleKey}:${entry.keys}`} className={styles['entry']}>
              <Kbd>{entry.keys}</Kbd>
              <span className={styles['desc']}>
                {t(entry.descKey, { defaultValue: entry.descKey })}
              </span>
            </div>
          ))}
        </div>
      )}
    </TacticalPanel>
  );
}
