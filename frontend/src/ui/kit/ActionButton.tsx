import type { MouseEvent, ReactNode } from 'react';
import styles from './ActionButton.module.css';
import { Kbd } from './Kbd';
import { cx } from './cx';

export function ActionButton({
  children,
  onClick,
  variant = 'default',
  size = 'md',
  kbd,
  disabled = false,
  title,
  type = 'button',
  className,
  'aria-pressed': ariaPressed,
}: {
  children: ReactNode;
  onClick?: ((e: MouseEvent<HTMLButtonElement>) => void) | undefined;
  variant?: 'default' | 'primary' | 'ghost' | 'danger' | 'active' | undefined;
  size?: 'sm' | 'md' | undefined;
  kbd?: string | undefined;
  disabled?: boolean | undefined;
  title?: string | undefined;
  type?: 'button' | 'submit' | 'reset' | undefined;
  className?: string | undefined;
  'aria-pressed'?: boolean | undefined;
}) {
  const isAccent = variant === 'active' || variant === 'primary';
  return (
    <button
      type={type}
      disabled={disabled}
      title={title}
      aria-pressed={ariaPressed}
      onClick={onClick}
      className={cx(styles['button'], styles[variant], styles[size], className)}
    >
      {kbd !== undefined && kbd.length > 0 && <Kbd active={isAccent}>{kbd}</Kbd>}
      <span>{children}</span>
    </button>
  );
}
