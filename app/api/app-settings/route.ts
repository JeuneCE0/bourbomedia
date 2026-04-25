import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { getAllSettings, setSetting, SETTINGS_DEFAULTS, type SettingKey } from '@/lib/app-settings';

export async function GET(req: NextRequest) {
  if (!requireAuth(req)) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });
  const settings = await getAllSettings();
  return NextResponse.json(settings);
}

// PUT /api/app-settings  body: { key, value } OR { ads_budget_monthly_cents: 250000 }
export async function PUT(req: NextRequest) {
  if (!requireAuth(req)) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });
  const body = await req.json().catch(() => ({}));

  // Accept either { key, value } or a partial object of known keys
  const updates: { key: SettingKey; value: unknown }[] = [];
  if (body.key && body.value !== undefined) {
    updates.push({ key: body.key, value: body.value });
  } else {
    for (const k of Object.keys(SETTINGS_DEFAULTS) as SettingKey[]) {
      if (k in body) updates.push({ key: k, value: body[k] });
    }
  }
  if (!updates.length) return NextResponse.json({ error: 'Aucun champ à mettre à jour' }, { status: 400 });

  for (const u of updates) {
    if (!(u.key in SETTINGS_DEFAULTS)) continue;
    await setSetting(u.key as SettingKey, u.value as never);
  }

  const settings = await getAllSettings();
  return NextResponse.json(settings);
}
