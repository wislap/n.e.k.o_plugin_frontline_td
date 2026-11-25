// Logistics inspection block of the inspector (ADR 0062 step 3): moved
// verbatim out of the shell's StructureSections.
import { useTranslation } from 'react-i18next';
import { localName } from '../../../content/index';
import { cx, MeterBar } from '../../../ui/kit/index';
import { inspectorStyles } from '../../../ui/inspector/index';
import type { LogisticsInspection } from '../protocol';

const styles = inspectorStyles;

export function LogisticsSection({ logistics }: { logistics: LogisticsInspection | null }) {
  const { t } = useTranslation();
  if (logistics === null) return null;
  return (
    <div className={styles['section']}>
      {logistics.node !== null && (
        <div className={styles['metaRow']}>
          <span className={styles['accentText']}>
            {t('inspector.node_summary', {
              connect: Math.round(logistics.node.connect / 10),
              service: logistics.node.service,
              vehicles: logistics.node.vehicles,
            })}
          </span>
          {logistics.node.warehouse && (
            <span className={cx(styles['tag'], styles['tagAccent'])}>
              {t('inspector.warehouse_tag')}
            </span>
          )}
        </div>
      )}
      {logistics.slots.map((slot, i) => {
        const name = localName(String(slot.cargo));
        return (
          <div key={i} className={styles['slotBlock']}>
            <MeterBar
              bp={(slot.amount / Math.max(1, slot.capacity)) * 10000}
              tone="mode"
              label={t(`cargo.${name}`, { defaultValue: name })}
              valueText={`${Math.floor(slot.amount / 1000)}/${Math.floor(slot.capacity / 1000)}`}
            />
            <div className={styles['tagRow']}>
              <span className={styles['tag']}>
                {t(`class.${slot.class}`, { defaultValue: slot.class })}
              </span>
              {slot.export && <span className={styles['tag']}>{t('panel.export')}</span>}
              {slot.unmet !== 'none' && (
                <span className={cx(styles['tag'], styles['tagWarn'])}>
                  {t(`reason.${slot.unmet}`, { defaultValue: slot.unmet })}
                </span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
