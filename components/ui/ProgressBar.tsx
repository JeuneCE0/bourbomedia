'use client';
import React from 'react';

interface Props {
  value: number;
  max?: number;
  label?: string;
  showPercent?: boolean;
  height?: number;
  color?: string;
}

export default function ProgressBar({
  value,
  max = 100,
  label,
  showPercent = true,
  height = 8,
  color = 'var(--orange)',
}: Props) {
  const safeMax = Math.max(1, max);
  const pct = Math.max(0, Math.min(100, (value / safeMax) * 100));
  return (
    <div>
      {(label || showPercent) ? (
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6, fontSize: 12, color: 'var(--text-mid)' }}>
          {label ? <span>{label}</span> : <span />}
          {showPercent ? <span style={{ fontWeight: 700, color: 'var(--text)' }}>{Math.round(pct)}%</span> : null}
        </div>
      ) : null}
      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={safeMax}
        aria-valuenow={value}
        aria-label={label}
        style={{
          width: '100%',
          height,
          background: 'var(--night-raised)',
          borderRadius: height,
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            width: `${pct}%`,
            height: '100%',
            background: color,
            borderRadius: height,
            transition: 'width .4s ease',
          }}
        />
      </div>
    </div>
  );
}
