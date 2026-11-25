// Combat inspection block of the inspector (ADR 0062 step 3): moved
// verbatim out of the shell's StructureSections.
import { useTranslation } from 'react-i18next';
import { MeterBar } from '../../../ui/kit/index';
import { inspectorStyles } from '../../../ui/inspector/index';
import type { CombatInspection } from '../protocol';

const styles = inspectorStyles;

export function CombatSection({ combat }: { combat: CombatInspection | null }) {
  const { t } = useTranslation();
  if (combat === null) return null;
  return (
    <div className={styles['section']}>
      {combat.max > 0 && (
        <MeterBar
          bp={(combat.hp / Math.max(1, combat.max)) * 10000}
          label={t('inspector.hp_label')}
          valueText={`${Math.ceil(combat.hp / 1000)}/${Math.ceil(combat.max / 1000)}`}
        />
      )}
      {combat.readyIn !== undefined && (
        <div className={styles['metaRow']}>
          <span className={styles['kvLabel']}>
            {combat.readyIn === 0
              ? t('panel.weapon_ready')
              : t('panel.weapon_reloading', { ticks: combat.readyIn })}
          </span>
          {combat.costCargo !== undefined && combat.costCargo >= 0 && (
            <span className={styles['kvValue']}>
              {t('panel.ammo', { count: Math.floor((combat.costStock ?? 0) / 1000) })}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
