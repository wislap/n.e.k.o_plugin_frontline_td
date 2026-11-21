import styles from './RateBadge.module.css';
import { cx } from './cx';

export function RateBadge({
  milliPerSec,
  suffix = '/s',
  className,
}: {
  milliPerSec: number;
  suffix?: string | undefined;
  className?: string | undefined;
}) {
  const rounded = Math.round((milliPerSec / 1000) * 10) / 10;
  const abs = Math.abs(rounded);
  const numText = Number.isInteger(abs) ? String(abs) : abs.toFixed(1);
  const tone = rounded > 0 ? 'pos' : rounded < 0 ? 'neg' : 'flat';
  const sign = rounded > 0 ? '+' : rounded < 0 ? '-' : '';
  const text = `${sign}${numText}${suffix}`;

  return <span className={cx(styles['badge'], styles[tone], className)}>{text}</span>;
}
