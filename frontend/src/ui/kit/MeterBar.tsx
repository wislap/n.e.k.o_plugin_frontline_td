import type { ReactNode } from 'react';
import styles from './MeterBar.module.css';
import { cx } from './cx';

type ResolvedTone = 'mode' | 'ok' | 'warn' | 'danger';

function resolveTone(bp: number, tone: 'auto' | ResolvedTone): ResolvedTone {
  if (tone !== 'auto') {
    return tone;
  }
  if (bp <= 2500) {
    return 'danger';
  }
  if (bp <= 5500) {
    return 'warn';
  }
  return 'ok';
}

export function MeterBar({
  bp,
  tone = 'auto',
  label,
  valueText,
  className,
}: {
  bp: number;
  tone?: 'auto' | 'mode' | 'ok' | 'warn' | 'danger' | undefined;
  label?: ReactNode | undefined;
  valueText?: ReactNode | undefined;
  className?: string | undefined;
}) {
  const clamped = Math.max(0, Math.min(10000, bp));
  const pct = clamped / 100;
  const resolved = resolveTone(clamped, tone);
  const hasRow = label !== undefined || valueText !== undefined;

  return (
    <div className={cx(styles['root'], className)}>
      {hasRow && (
        <div className={styles['row']}>
          <span className={styles['label']}>{label}</span>
          <span className={styles['value']}>{valueText}</span>
        </div>
      )}
      <div
        className={styles['track']}
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={10000}
        aria-valuenow={Math.round(clamped)}
      >
        <div
          className={cx(styles['fill'], styles[`tone-${resolved}`])}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
