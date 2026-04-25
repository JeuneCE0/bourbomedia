'use client';
import React from 'react';

interface Props {
  width?: number | string;
  height?: number | string;
  radius?: number | string;
  style?: React.CSSProperties;
}

export default function Skeleton({ width = '100%', height = 16, radius = 8, style }: Props) {
  return (
    <span
      aria-hidden
      style={{
        display: 'block',
        width,
        height,
        borderRadius: radius,
        background:
          'linear-gradient(90deg, rgba(255,255,255,.04) 0%, rgba(255,255,255,.16) 50%, rgba(255,255,255,.04) 100%)',
        backgroundSize: '200% 100%',
        animation: 'bm-shimmer 1.4s ease-in-out infinite',
        ...style,
      }}
    />
  );
}

export function SkeletonCard({ lines = 3 }: { lines?: number }) {
  return (
    <div
      style={{
        background: 'var(--night-card)',
        border: '1px solid var(--border)',
        borderRadius: 14,
        padding: 20,
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
      }}
    >
      <Skeleton height={18} width="40%" />
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton key={i} height={12} width={i === lines - 1 ? '60%' : '85%'} />
      ))}
    </div>
  );
}
