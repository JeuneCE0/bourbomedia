'use client';
import React from 'react';

interface Props {
  emoji: string;
  label: string;
  size?: number | string;
  decorative?: boolean;
  style?: React.CSSProperties;
  className?: string;
}

/**
 * Accessible emoji wrapper. Adds role="img" + aria-label so screen readers
 * announce something useful instead of the raw codepoint.
 * For purely decorative emojis, set decorative={true}.
 */
export default function EmojiIcon({
  emoji,
  label,
  size,
  decorative = false,
  style,
  className,
}: Props) {
  const fontSize = size === undefined ? undefined : typeof size === 'number' ? `${size}px` : size;
  return (
    <span
      role={decorative ? 'presentation' : 'img'}
      aria-label={decorative ? undefined : label}
      aria-hidden={decorative ? true : undefined}
      className={className}
      style={{
        display: 'inline-block',
        lineHeight: 1,
        fontSize,
        fontFamily: '"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif',
        ...style,
      }}
    >
      {emoji}
    </span>
  );
}
