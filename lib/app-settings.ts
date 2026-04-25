import { supaFetch } from '@/lib/supabase';

// Typed schema for everything stored in app_settings. Add a key here, expose it
// via getSetting/setSetting, and it shows up in the Settings page automatically
// if you also add an entry in the SETTINGS_DEFINITIONS array.

export interface GhlPipelineMapping {
  pipeline_name: string;
  pipeline_id?: string;
  stages: Record<string, string>; // GHL stage name → our prospect_status
  stage_ids?: Record<string, string>; // GHL stage name → GHL stage ID (resolved by backfill)
}

export interface AppSettings {
  ads_budget_monthly_cents: number;
  ghl_pipeline_mapping: GhlPipelineMapping;
}

export const SETTINGS_DEFAULTS: AppSettings = {
  ads_budget_monthly_cents: 0,
  ghl_pipeline_mapping: {
    pipeline_name: 'Pipeline Bourbon Média',
    stages: {
      'En réflexion': 'reflection',
      'Ghosting': 'ghosting',
      'Follow-up': 'follow_up',
      'Attente signature + paiement': 'awaiting_signature',
      'Contracté': 'contracted',
      'Client régulier': 'regular',
    },
  },
};

export type SettingKey = keyof AppSettings;

export async function getSetting<K extends SettingKey>(key: K): Promise<AppSettings[K]> {
  const r = await supaFetch(`app_settings?key=eq.${encodeURIComponent(key)}&select=value&limit=1`, {}, true);
  if (!r.ok) return SETTINGS_DEFAULTS[key];
  const arr = await r.json();
  if (!arr[0]) return SETTINGS_DEFAULTS[key];
  return arr[0].value as AppSettings[K];
}

export async function getAllSettings(): Promise<AppSettings> {
  const r = await supaFetch('app_settings?select=key,value', {}, true);
  if (!r.ok) return { ...SETTINGS_DEFAULTS };
  const rows: { key: string; value: unknown }[] = await r.json();
  const out: AppSettings = { ...SETTINGS_DEFAULTS };
  for (const row of rows) {
    if (row.key in out) {
      (out as unknown as Record<string, unknown>)[row.key] = row.value;
    }
  }
  return out;
}

export async function setSetting<K extends SettingKey>(key: K, value: AppSettings[K]): Promise<boolean> {
  const r = await supaFetch('app_settings?on_conflict=key', {
    method: 'POST',
    headers: { 'Prefer': 'resolution=merge-duplicates,return=representation' },
    body: JSON.stringify({ key, value, updated_at: new Date().toISOString() }),
  }, true);
  return r.ok;
}

// ── Helpers for ads budget pro-rata ─────────────────────────────────────────

export function daysInMonth(year: number, month0: number): number {
  return new Date(year, month0 + 1, 0).getDate();
}

export function adsBudgetForRange(monthlyCents: number, fromIso: string, toIso: string): number {
  // Pro-rata across the date range, accounting for month boundaries.
  // If the range spans multiple months, sum each month's contribution.
  const from = new Date(fromIso);
  const to = new Date(toIso);
  if (to < from) return 0;
  let total = 0;
  const cursor = new Date(from);
  cursor.setHours(0, 0, 0, 0);
  while (cursor <= to) {
    const dim = daysInMonth(cursor.getFullYear(), cursor.getMonth());
    total += monthlyCents / dim;
    cursor.setDate(cursor.getDate() + 1);
  }
  return Math.round(total);
}
