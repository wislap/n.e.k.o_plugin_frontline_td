import type { ReactNode } from 'react';
import styles from './Kbd.module.css';
import { cx } from './cx';

export function Kbd({
  children,
  active = false,
  className,
}: {
  children: ReactNode;
  active?: boolean | undefined;
  className?: string | undefined;
}) {
  return <kbd className={cx(styles['kbd'], active && styles['active'], className)}>{children}</kbd>;
}
