import type { ReactNode } from 'react';
import type { PrimaryMode } from '../client/interaction-store';
import { cx } from './kit/index';
import styles from './HudShell.module.css';

export function HudShell({
  primaryMode,
  topLeft,
  topCenter,
  topRight,
  middleLeft,
  bottomLeft,
  bottomCenter,
  bottomRight,
}: {
  primaryMode: PrimaryMode;
  topLeft?: ReactNode | undefined;
  topCenter?: ReactNode | undefined;
  topRight?: ReactNode | undefined;
  middleLeft?: ReactNode | undefined;
  bottomLeft?: ReactNode | undefined;
  bottomCenter?: ReactNode | undefined;
  bottomRight?: ReactNode | undefined;
}) {
  return (
    <div className={styles['shell']} data-mode={primaryMode}>
      <div className={cx(styles['slot'], styles['topLeft'])}>{topLeft}</div>
      <div className={cx(styles['slot'], styles['topCenter'])}>{topCenter}</div>
      <div className={cx(styles['slot'], styles['topRight'])}>{topRight}</div>
      <div className={cx(styles['slot'], styles['middleLeft'])}>{middleLeft}</div>
      <div className={cx(styles['slot'], styles['bottomLeft'])}>{bottomLeft}</div>
      <div className={cx(styles['slot'], styles['bottomCenter'])}>{bottomCenter}</div>
      <div className={cx(styles['slot'], styles['bottomRight'])}>{bottomRight}</div>
    </div>
  );
}
