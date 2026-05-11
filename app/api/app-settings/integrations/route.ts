import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';

// Returns boolean status of every external integration the platform expects.
// Read-only — these come from Vercel env vars and can't be edited from the UI.

export async function GET(req: NextRequest) {
  if (!requireAuth(req)) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });

  const has = (k: string) => !!process.env[k];

  return NextResponse.json({
    ghl: has('GHL_API_KEY') && has('GHL_LOCATION_ID'),
    ghl_location_id: process.env.GHL_LOCATION_ID || null,
    ghl_calendars: {
      closing: has('GHL_CLOSING_CALENDAR_ID'),
      onboarding: has('GHL_ONBOARDING_CALENDAR_ID'),
      tournage: has('GHL_FILMING_CALENDAR_ID'),
    },
    ghl_webhook_secret: has('GHL_WEBHOOK_SECRET'),
    slack: has('SLACK_WEBHOOK_URL'),
    stripe: has('STRIPE_SECRET_KEY') && has('STRIPE_WEBHOOK_SECRET'),
    anthropic: has('ANTHROPIC_API_KEY'),
    automations_paused: process.env.AUTOMATIONS_PAUSED === 'true',
  });
}
