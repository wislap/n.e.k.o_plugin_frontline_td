import type { ReactNode } from 'react';
import { Kbd } from './Kbd';
import styles from './SegmentedTabs.module.css';
import { cx } from './cx';

export function SegmentedTabs<T extends string>({
  items,
  value,
  onChange,
  size = 'md',
  className,
  ariaLabel,
}: {
  items: readonly {
    value: T;
    label: ReactNode;
    kbd?: string | undefined;
    disabled?: boolean | undefined;
  }[];
  value: T;
  onChange: (value: T) => void;
  size?: 'sm' | 'md' | undefined;
  className?: string | undefined;
  ariaLabel?: string | undefined;
}) {
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className={cx(styles['list'], styles[size], className)}
    >
      {items.map((item) => {
        const active = item.value === value;
        return (
          <button
            key={item.value}
            type="button"
            role="tab"
            aria-selected={active}
            disabled={item.disabled}
            onClick={() => {
              onChange(item.value);
            }}
            className={cx(styles['tab'], active && styles['active'])}
          >
            {item.kbd !== undefined && item.kbd.length > 0 && <Kbd active={active}>{item.kbd}</Kbd>}
            <span>{item.label}</span>
          </button>
        );
      })}
    </div>
  );
}
