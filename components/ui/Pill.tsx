'use client';
import React from 'react';

type Tone = 'orange' | 'green' | 'blue' | 'red' | 'yellow' | 'neutral' | 'purple';

interface Props {
  tone?: Tone;
  emoji?: string;
  size?: 'sm' | 'md';
  children: React.ReactNode;
  style?: React.CSSProperties;
}

const TONES: Record<Tone, { bg: string; border: string; color: string }> = {
  orange: { bg: 'rgba(232,105,43,.16)', border: 'rgba(232,105,43,.45)', color: '#FFB58A' },
  green: { bg: 'rgba(34,197,94,.14)', border: 'rgba(34,197,94,.40)', color: '#86EFAC' },
  blue: { bg: 'rgba(59,130,246,.16)', border: 'rgba(59,130,246,.40)', color: '#93C5FD' },
  red: { bg: 'rgba(239,68,68,.16)', border: 'rgba(239,68,68,.45)', color: '#FCA5A5' },
  yellow: { bg: 'rgba(250,204,21,.18)', border: 'rgba(250,204,21,.50)', color: '#FDE68A' },
  neutral: { bg: 'var(--night-raised)', border: 'var(--border-md)', color: 'var(--text-mid)' },
  purple: { bg: 'rgba(168,85,247,.16)', border: 'rgba(168,85,247,.40)', color: '#D8B4FE' },
};

export default function Pill({ tone = 'neutral', emoji, size = 'md', children, style }: Props) {
  const t = TONES[tone];
  const padding = size === 'sm' ? '3px 9px' : '5px 12px';
  const fontSize = size === 'sm' ? 11 : 12.5;
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding,
        background: t.bg,
        border: `1px solid ${t.border}`,
        color: t.color,
        borderRadius: 999,
        fontSize,
        fontWeight: 600,
        whiteSpace: 'nowrap',
        ...style,
      }}
    >
      {emoji ? <span aria-hidden style={{ lineHeight: 1, fontSize: fontSize + 1 }}>{emoji}</span> : null}
      {children}
    </span>
  );
}
