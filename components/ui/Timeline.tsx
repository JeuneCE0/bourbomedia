'use client';
import React from 'react';

export interface TimelineItem {
  key: string;
  emoji?: string;
  title: string;
  date?: string | null;
  description?: string | null;
  status: 'done' | 'current' | 'pending';
  highlight?: string;
}

interface Props {
  items: TimelineItem[];
}

export default function Timeline({ items }: Props) {
  return (
    <ol style={{ listStyle: 'none', padding: 0, margin: 0 }}>
      {items.map((it, i) => (
        <Row key={it.key} item={it} isLast={i === items.length - 1} />
      ))}
    </ol>
  );
}

function Row({ item, isLast }: { item: TimelineItem; isLast: boolean }) {
  const isDone = item.status === 'done';
  const isCurrent = item.status === 'current';
  const dotBg = isCurrent ? 'var(--orange)' : isDone ? 'var(--green)' : 'transparent';
  const dotBorder = isCurrent ? 'var(--orange)' : isDone ? 'var(--green)' : 'var(--border-md)';
  const lineBg = isDone ? 'var(--green)' : 'var(--border)';
  const titleColor = item.status === 'pending' ? 'var(--text-mid)' : 'var(--text)';
  return (
    <li
      style={{
        display: 'grid',
        gridTemplateColumns: '36px 1fr',
        gap: 12,
        alignItems: 'flex-start',
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', minHeight: 56 }}>
        <span
          aria-hidden
          style={{
            width: 30,
            height: 30,
            borderRadius: '50%',
            background: dotBg,
            border: `2px solid ${dotBorder}`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#fff',
            fontSize: 14,
            flexShrink: 0,
            fontFamily: '"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif',
          }}
        >
          {isDone ? '✓' : item.emoji || ''}
        </span>
        {!isLast ? <span aria-hidden style={{ flex: 1, width: 2, background: lineBg, marginTop: 4 }} /> : null}
      </div>
      <div style={{ paddingBottom: 22 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ fontWeight: isCurrent ? 700 : 600, color: titleColor, fontSize: 15 }}>{item.title}</span>
          {isCurrent ? (
            <span
              style={{
                padding: '2px 8px',
                borderRadius: 999,
                background: 'rgba(232,105,43,.16)',
                border: '1px solid rgba(232,105,43,.45)',
                color: '#FFB58A',
                fontSize: 10.5,
                fontWeight: 700,
                letterSpacing: 0.4,
              }}
            >
              VOUS ÊTES ICI
            </span>
          ) : null}
          {item.highlight ? (
            <span
              style={{
                padding: '2px 8px',
                borderRadius: 999,
                background: 'rgba(250,204,21,.16)',
                border: '1px solid rgba(250,204,21,.40)',
                color: '#FDE68A',
                fontSize: 10.5,
                fontWeight: 700,
              }}
            >
              {item.highlight}
            </span>
          ) : null}
        </div>
        {item.date ? (
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>{item.date}</div>
        ) : null}
        {item.description ? (
          <div style={{ fontSize: 13, color: 'var(--text-mid)', marginTop: 4, lineHeight: 1.5 }}>{item.description}</div>
        ) : null}
      </div>
    </li>
  );
}
