'use client';
import React from 'react';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'success';
type Size = 'sm' | 'md' | 'lg';

interface Props extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  leftEmoji?: string;
  rightEmoji?: string;
  fullWidth?: boolean;
}

const SIZES: Record<Size, React.CSSProperties> = {
  sm: { padding: '6px 12px', fontSize: 13, borderRadius: 8 },
  md: { padding: '10px 16px', fontSize: 14, borderRadius: 10 },
  lg: { padding: '14px 22px', fontSize: 15, borderRadius: 12 },
};

function variantStyle(v: Variant, disabled: boolean): React.CSSProperties {
  const base: React.CSSProperties = {
    border: '1px solid transparent',
    fontWeight: 600,
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.55 : 1,
    transition: 'background 200ms cubic-bezier(0.16, 1, 0.3, 1), border-color 150ms, box-shadow 200ms, transform 80ms ease-out, filter 150ms',
    fontFamily: 'inherit',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    whiteSpace: 'nowrap',
    position: 'relative',
    overflow: 'hidden',
  };
  switch (v) {
    case 'primary':
      return { ...base, background: 'var(--orange)', color: '#fff' };
    case 'secondary':
      return { ...base, background: 'var(--night-card)', color: 'var(--text)', borderColor: 'var(--border-md)' };
    case 'ghost':
      return { ...base, background: 'transparent', color: 'var(--text)', borderColor: 'var(--border)' };
    case 'danger':
      return { ...base, background: 'var(--red)', color: '#fff' };
    case 'success':
      return { ...base, background: 'var(--green)', color: '#0b1f12' };
  }
}

export default function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  leftEmoji,
  rightEmoji,
  fullWidth,
  disabled,
  children,
  style,
  className,
  ...rest
}: Props) {
  const isDisabled = disabled || loading;
  return (
    <button
      {...rest}
      disabled={isDisabled}
      className={`bm-press ${className || ''}`}
      onMouseEnter={e => {
        if (!isDisabled && variant === 'primary') {
          e.currentTarget.style.boxShadow = '0 8px 22px rgba(232,105,43,.35)';
        } else if (!isDisabled && variant === 'success') {
          e.currentTarget.style.boxShadow = '0 8px 22px rgba(34,197,94,.35)';
        } else if (!isDisabled && variant === 'danger') {
          e.currentTarget.style.boxShadow = '0 8px 22px rgba(239,68,68,.35)';
        }
        rest.onMouseEnter?.(e);
      }}
      onMouseLeave={e => {
        e.currentTarget.style.boxShadow = '';
        rest.onMouseLeave?.(e);
      }}
      style={{
        ...variantStyle(variant, !!isDisabled),
        ...SIZES[size],
        width: fullWidth ? '100%' : undefined,
        ...style,
      }}
    >
      {loading ? (
        <span
          aria-hidden
          style={{
            width: 14,
            height: 14,
            borderRadius: '50%',
            border: '2px solid currentColor',
            borderTopColor: 'transparent',
            animation: 'bm-spin .7s linear infinite',
          }}
        />
      ) : leftEmoji ? (
        <span aria-hidden style={{ lineHeight: 1 }}>{leftEmoji}</span>
      ) : null}
      <span>{children}</span>
      {rightEmoji && !loading ? <span aria-hidden style={{ lineHeight: 1 }}>{rightEmoji}</span> : null}
    </button>
  );
}
