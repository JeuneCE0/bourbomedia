'use client';
import React from 'react';

export interface Step {
  key: string;
  label: string;
  emoji?: string;
  description?: string;
}

interface Props {
  steps: Step[];
  currentIndex: number;
  orientation?: 'horizontal' | 'vertical';
  onClickStep?: (index: number) => void;
}

export default function Stepper({ steps, currentIndex, orientation = 'horizontal', onClickStep }: Props) {
  if (orientation === 'vertical') {
    return (
      <ol style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 0 }}>
        {steps.map((step, i) => {
          const status: 'done' | 'current' | 'pending' = i < currentIndex ? 'done' : i === currentIndex ? 'current' : 'pending';
          return <VerticalStep key={step.key} step={step} status={status} isLast={i === steps.length - 1} onClick={onClickStep ? () => onClickStep(i) : undefined} />;
        })}
      </ol>
    );
  }

  return (
    <div role="list" style={{ display: 'flex', alignItems: 'center', gap: 6, overflowX: 'auto', paddingBottom: 4 }}>
      {steps.map((step, i) => {
        const status: 'done' | 'current' | 'pending' = i < currentIndex ? 'done' : i === currentIndex ? 'current' : 'pending';
        return (
          <React.Fragment key={step.key}>
            <div
              role="listitem"
              aria-current={status === 'current' ? 'step' : undefined}
              onClick={onClickStep ? () => onClickStep(i) : undefined}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 8,
                padding: '8px 12px',
                borderRadius: 999,
                background:
                  status === 'current' ? 'var(--orange)' : status === 'done' ? 'rgba(34,197,94,.14)' : 'var(--night-card)',
                color: status === 'current' ? '#fff' : status === 'done' ? 'var(--green)' : 'var(--text-mid)',
                border: `1px solid ${status === 'current' ? 'var(--orange-dark)' : status === 'done' ? 'rgba(34,197,94,.35)' : 'var(--border)'}`,
                fontWeight: 600,
                fontSize: 13,
                whiteSpace: 'nowrap',
                cursor: onClickStep ? 'pointer' : 'default',
              }}
            >
              <span aria-hidden style={{ fontSize: 14, lineHeight: 1 }}>
                {status === 'done' ? '✅' : step.emoji || `${i + 1}`}
              </span>
              <span>{step.label}</span>
            </div>
            {i < steps.length - 1 ? (
              <span
                aria-hidden
                style={{
                  flex: '0 0 16px',
                  height: 2,
                  background: i < currentIndex ? 'var(--green)' : 'var(--border)',
                  borderRadius: 2,
                }}
              />
            ) : null}
          </React.Fragment>
        );
      })}
    </div>
  );
}

function VerticalStep({
  step,
  status,
  isLast,
  onClick,
}: {
  step: Step;
  status: 'done' | 'current' | 'pending';
  isLast: boolean;
  onClick?: () => void;
}) {
  const dotColor = status === 'done' ? 'var(--green)' : status === 'current' ? 'var(--orange)' : 'var(--border-md)';
  const lineColor = status === 'done' ? 'var(--green)' : 'var(--border)';
  const titleColor = status === 'pending' ? 'var(--text-mid)' : 'var(--text)';
  return (
    <li
      onClick={onClick}
      style={{
        display: 'grid',
        gridTemplateColumns: '36px 1fr',
        gap: 12,
        alignItems: 'flex-start',
        cursor: onClick ? 'pointer' : 'default',
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', minHeight: 56 }}>
        <span
          aria-hidden
          style={{
            width: 28,
            height: 28,
            borderRadius: '50%',
            background: status === 'current' ? dotColor : 'transparent',
            border: `2px solid ${dotColor}`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: status === 'current' ? '#fff' : dotColor,
            fontSize: 14,
            fontWeight: 700,
            flexShrink: 0,
            fontFamily: '"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif',
          }}
        >
          {status === 'done' ? '✓' : step.emoji || ''}
        </span>
        {!isLast ? <span aria-hidden style={{ flex: 1, width: 2, background: lineColor, marginTop: 4 }} /> : null}
      </div>
      <div style={{ paddingBottom: 18 }}>
        <div
          style={{
            fontWeight: status === 'current' ? 700 : 600,
            color: titleColor,
            fontSize: 15,
          }}
          aria-current={status === 'current' ? 'step' : undefined}
        >
          {step.label}
          {status === 'current' ? (
            <span style={{ marginLeft: 8, fontSize: 11, color: 'var(--orange)', fontWeight: 700 }}>
              VOUS ÊTES ICI
            </span>
          ) : null}
        </div>
        {step.description ? (
          <div style={{ fontSize: 13, color: 'var(--text-mid)', marginTop: 4, lineHeight: 1.5 }}>{step.description}</div>
        ) : null}
      </div>
    </li>
  );
}
