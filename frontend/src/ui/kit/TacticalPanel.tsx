import type { ReactNode } from 'react';
import styles from './TacticalPanel.module.css';
import { cx } from './cx';

export function TacticalPanel({
  children,
  tone = 'mode',
  title,
  badge,
  headerActions,
  compact = false,
  className,
  bodyClassName,
}: {
  children: ReactNode;
  tone?: 'mode' | 'neutral' | 'preview' | 'danger' | 'warn' | undefined;
  title?: ReactNode | undefined;
  badge?: ReactNode | undefined;
  headerActions?: ReactNode | undefined;
  compact?: boolean | undefined;
  className?: string | undefined;
  bodyClassName?: string | undefined;
}) {
  const hasHeader = title !== undefined || badge !== undefined || headerActions !== undefined;
  return (
    <section
      className={cx(
        styles['panel'],
        styles[`tone-${tone}`],
        compact && styles['compact'],
        className,
      )}
    >
      {hasHeader && (
        <header className={styles['header']}>
          <div className={styles['headerLeft']}>
            {title !== undefined && <div className={styles['title']}>{title}</div>}
            {badge !== undefined && <span className={styles['badge']}>{badge}</span>}
          </div>
          {headerActions !== undefined && <div className={styles['actions']}>{headerActions}</div>}
        </header>
      )}
      <div className={cx(styles['body'], bodyClassName)}>{children}</div>
    </section>
  );
}
