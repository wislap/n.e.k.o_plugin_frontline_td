// Production inspection block of the inspector (ADR 0062 step 3): the
// production part of the old OwnStructureView, moved verbatim.
import { useTranslation } from 'react-i18next';
import { localName, type ContentDb } from '../../../content/index';
import { inspectorStyles } from '../../../ui/inspector/index';
import type { ProductionInspection } from '../protocol';

const styles = inspectorStyles;

export function ProductionSection({
  production,
  db,
}: {
  production: ProductionInspection | null;
  db: ContentDb;
}) {
  const { t } = useTranslation();
  const p = production;
  if (p === null) return null;
  return (
    <div className={styles['section']}>
      <div className={styles['kvRow']}>
        <span className={styles['kvLabel']}>{t('panel.production')}</span>
        <span
          className={styles['kvValue']}
        >{`${t(`prod.${p.state}`, { defaultValue: p.state })}${p.total > 0 ? ` (${p.progress}/${p.total})` : ''}`}</span>
      </div>
      {p.nextUnit !== undefined && p.nextUnit !== '' && (
        <div className={styles['accentText']}>
          {t('panel.next_unit', {
            name: t(`unit.${localName(p.nextUnit)}`, { defaultValue: localName(p.nextUnit) }),
          })}
        </div>
      )}
      {p.missing.length > 0 && (
        <div className={styles['warnText']}>
          {p.missing
            .map((idx) =>
              t(`cargo.${localName(db.cargos.byIndex(idx)?.id ?? String(idx))}`, {
                defaultValue: localName(db.cargos.byIndex(idx)?.id ?? String(idx)),
              }),
            )
            .join(', ')}
        </div>
      )}
    </div>
  );
}
