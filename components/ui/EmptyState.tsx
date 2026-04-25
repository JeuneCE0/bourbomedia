'use client';
import React from 'react';

interface Props {
  emoji?: string;
  title: string;
  description?: string;
  action?: React.ReactNode;
  compact?: boolean;
}

export default function EmptyState({ emoji = '✨', title, description, action, compact }: Props) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        textAlign: 'center',
        padding: compact ? '24px 16px' : '48px 24px',
        gap: 10,
      }}
    >
      <div
        aria-hidden
        style={{
          fontSize: compact ? 36 : 48,
          lineHeight: 1,
          marginBottom: 4,
          fontFamily: '"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif',
        }}
      >
        {emoji}
      </div>
      <div style={{ fontWeight: 700, fontSize: compact ? 15 : 17, color: 'var(--text)' }}>{title}</div>
      {description ? (
        <div style={{ fontSize: 13, color: 'var(--text-mid)', maxWidth: 380, lineHeight: 1.5 }}>{description}</div>
      ) : null}
      {action ? <div style={{ marginTop: 8 }}>{action}</div> : null}
    </div>
  );
}
