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
  middleRight,
  bottomLeft,
  bottomCenter,
  bottomRight,
}: {
  primaryMode: PrimaryMode;
  topLeft?: ReactNode | undefined;
  topCenter?: ReactNode | undefined;
  topRight?: ReactNode | undefined;
  middleLeft?: ReactNode | undefined;
  middleRight?: ReactNode | undefined;
  bottomLeft?: ReactNode | undefined;
  bottomCenter?: ReactNode | undefined;
  bottomRight?: ReactNode | undefined;
}) {
  return (
    <div className={styles['shell']} data-mode={primaryMode}>
      <div className={styles['colLeft']}>
        <div className={cx(styles['slot'], styles['topLeft'])} data-hud-slot="topLeft">
          {topLeft}
        </div>
        <div className={cx(styles['slot'], styles['middleLeft'])} data-hud-slot="middleLeft">
          {middleLeft}
        </div>
        <div className={cx(styles['slot'], styles['bottomLeft'])} data-hud-slot="bottomLeft">
          {bottomLeft}
        </div>
      </div>
      <div className={styles['colCenter']}>
        <div className={cx(styles['slot'], styles['topCenter'])} data-hud-slot="topCenter">
          {topCenter}
        </div>
        <div className={cx(styles['slot'], styles['bottomCenter'])} data-hud-slot="bottomCenter">
          {bottomCenter}
        </div>
      </div>
      <div className={styles['colRight']}>
        <div className={cx(styles['slot'], styles['topRight'])} data-hud-slot="topRight">
          {topRight}
        </div>
        <div className={cx(styles['slot'], styles['middleRight'])} data-hud-slot="middleRight">
          {middleRight}
        </div>
        <div className={cx(styles['slot'], styles['bottomRight'])} data-hud-slot="bottomRight">
          {bottomRight}
        </div>
      </div>
    </div>
  );
}
