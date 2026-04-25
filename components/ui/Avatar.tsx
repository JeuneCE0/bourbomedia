'use client';
import React from 'react';

interface Props {
  name?: string | null;
  size?: number;
  emoji?: string;
}

const AVATAR_PALETTE = [
  '#E8692B',
  '#22C55E',
  '#3B82F6',
  '#A855F7',
  '#EC4899',
  '#F59E0B',
  '#14B8A6',
  '#EF4444',
];

function colorFor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return AVATAR_PALETTE[h % AVATAR_PALETTE.length];
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export default function Avatar({ name, size = 36, emoji }: Props) {
  const safe = name?.trim() || '?';
  const bg = colorFor(safe);
  return (
    <span
      role="img"
      aria-label={safe}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: size,
        height: size,
        borderRadius: '50%',
        background: bg,
        color: '#fff',
        fontWeight: 700,
        fontSize: Math.round(size * 0.4),
        flexShrink: 0,
        fontFamily: '"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif',
        userSelect: 'none',
      }}
    >
      {emoji || initials(safe)}
    </span>
  );
}
