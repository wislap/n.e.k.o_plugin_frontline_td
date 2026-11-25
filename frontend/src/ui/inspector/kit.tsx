// Shared inspector kit (ADR 0062 step 3): the action row, the modifiers
// tag section and small helpers every subject view reuses, plus the
// panel's CSS module so moved views keep identical class names.
import { useTranslation } from 'react-i18next';
import type { Inspection } from '../../core/index';
import { ActionButton, cx } from '../kit/index';
import styles from './InspectorPanel.module.css';

export const inspectorStyles = styles;

export interface InspectorActionContext {
  isPinned: boolean;
  canActivate: boolean;
  canDemolish: boolean;
  hasConfirm: boolean;
  onActivate: () => void;
  onDemolish: () => void;
  onConfirmDemolish: () => void;
}

export function hpValueText(hpBp: number, maxHp: number): string {
  return maxHp > 0 ? `${Math.ceil((hpBp * maxHp) / 10000)}/${maxHp}` : `${Math.round(hpBp / 100)}%`;
}

export function InspectorActions({
  actions,
  showActivate,
  showDemolish,
}: {
  actions: InspectorActionContext;
  showActivate: boolean;
  showDemolish: boolean;
}) {
  const { t } = useTranslation();
  if (!actions.isPinned || (!showActivate && !showDemolish && !actions.hasConfirm)) {
    return null;
  }
  return (
    <div className={styles['actionsRow']}>
      {showActivate && (
        <ActionButton size="sm" variant="primary" kbd="G" onClick={actions.onActivate}>
          {t('inspector.activate_action')}
        </ActionButton>
      )}
      {actions.hasConfirm ? (
        <ActionButton size="sm" variant="danger" kbd="C" onClick={actions.onConfirmDemolish}>
          {t('inspector.confirm_demolish_btn')}
        </ActionButton>
      ) : (
        showDemolish && (
          <ActionButton size="sm" variant="default" kbd="C" onClick={actions.onDemolish}>
            {t('inspector.demolish_action')}
          </ActionButton>
        )
      )}
    </div>
  );
}

export function ModifiersSection({ modifiers }: { modifiers: Inspection['modifiers'] }) {
  const { t } = useTranslation();
  if (modifiers.length === 0) return null;
  return (
    <div className={styles['section']}>
      <div className={styles['tagRow']}>
        {modifiers.map((m, i) => {
          const source = m.source.split('.').pop() ?? m.source;
          const val = m.op === 'mul_bp' ? `×${m.value / 10000}` : `+${m.value}`;
          return (
            <span key={i} className={cx(styles['tag'], styles['tagWarn'])}>
              {`${t(`mod.${source}`, { defaultValue: source })} ${val}`}
            </span>
          );
        })}
      </div>
    </div>
  );
}
