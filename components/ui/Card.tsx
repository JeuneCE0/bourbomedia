'use client';
import React from 'react';

interface Props extends React.HTMLAttributes<HTMLDivElement> {
  padding?: number | string;
  raised?: boolean;
  bordered?: boolean;
  accent?: boolean;
  /** Adds hover lift + shadow growth — opt-in (off by default to avoid jitter on static layouts) */
  interactive?: boolean;
  as?: keyof React.JSX.IntrinsicElements;
}

export default function Card({
  padding = 20,
  raised = false,
  bordered = true,
  accent = false,
  interactive = false,
  as: Tag = 'div',
  style,
  className,
  children,
  ...rest
}: Props) {
  const baseStyle: React.CSSProperties = {
    background: raised ? 'var(--night-raised)' : 'var(--night-card)',
    border: bordered ? `1px solid ${accent ? 'var(--border-orange)' : 'var(--border)'}` : 'none',
    borderRadius: 14,
    padding: typeof padding === 'number' ? `${padding}px` : padding,
    boxShadow: raised ? '0 4px 16px rgba(0,0,0,.25)' : undefined,
    ...style,
  };
  const finalClass = `${interactive ? 'bm-lift' : ''} ${className || ''}`.trim();
  return React.createElement(Tag as any, { ...rest, className: finalClass || undefined, style: baseStyle }, children);
}
