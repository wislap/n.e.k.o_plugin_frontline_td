import styles from './ToastStack.module.css';
import { cx } from './cx';

export interface ToastItem {
  id: string;
  tone: 'danger' | 'warn' | 'info';
  text: string;
}

export function ToastStack({
  workerError,
  errorPrefix,
  items,
  className,
}: {
  workerError: string | null;
  errorPrefix: string;
  items: readonly ToastItem[];
  className?: string | undefined;
}) {
  if (workerError === null && items.length === 0) {
    return null;
  }

  return (
    <div className={cx(styles['stack'], className)} aria-live="polite">
      {workerError !== null && (
        <div role="alert" className={cx(styles['item'], styles['workerAlert'])}>
          {`${errorPrefix} ${workerError}`}
        </div>
      )}
      {items.map((item) => (
        <div key={item.id} className={cx(styles['item'], styles[`tone-${item.tone}`])}>
          {item.text}
        </div>
      ))}
    </div>
  );
}
