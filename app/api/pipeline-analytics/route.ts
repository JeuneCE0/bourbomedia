import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { supaFetch } from '@/lib/supabase';

// GET /api/pipeline-analytics
//   Returns funnel volume per stage + conversion metrics + cycle time.
export async function GET(req: NextRequest) {
  if (!requireAuth(req)) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });

  // Pull all opportunities (we have ~300 max so OK in memory)
  const r = await supaFetch(
    'gh_opportunities?select=id,pipeline_stage_name,prospect_status,monetary_value_cents,ghl_created_at,ghl_updated_at&limit=2000',
    {}, true,
  );
  if (!r.ok) return NextResponse.json({ error: 'fetch failed' }, { status: 500 });
  type Opp = {
    id: string;
    pipeline_stage_name: string | null;
    prospect_status: string | null;
    monetary_value_cents: number | null;
    ghl_created_at: string | null;
    ghl_updated_at: string | null;
  };
  const opps: Opp[] = await r.json();

  // Volume per stage
  const stageVolume: Record<string, number> = {};
  const stageValue: Record<string, number> = {};
  for (const o of opps) {
    const stage = o.pipeline_stage_name || 'Inconnu';
    stageVolume[stage] = (stageVolume[stage] || 0) + 1;
    stageValue[stage] = (stageValue[stage] || 0) + (o.monetary_value_cents || 0);
  }

  // Won (contracted + regular)
  const won = opps.filter(o => o.prospect_status === 'contracted' || o.prospect_status === 'regular');
  const lost = opps.filter(o => o.prospect_status === 'closed_lost' || o.prospect_status === 'not_interested' || o.prospect_status === 'ghosting');
  const inProgress = opps.filter(o => o.prospect_status && ['reflection', 'follow_up', 'awaiting_signature'].includes(o.prospect_status));

  const total = opps.length;
  const won_count = won.length;
  const lost_count = lost.length;
  const conversion_global = total > 0 ? Math.round((won_count / total) * 100) : null;

  // Cycle time : avg days from ghl_created_at → now (for won opportunities, use updated_at as proxy for "contracted at")
  const wonWithTimes = won.filter(o => o.ghl_created_at && o.ghl_updated_at);
  const avgCycleDays = wonWithTimes.length > 0
    ? Math.round(
        wonWithTimes.reduce((s, o) => {
          const ms = new Date(o.ghl_updated_at!).getTime() - new Date(o.ghl_created_at!).getTime();
          return s + ms / 86400000;
        }, 0) / wonWithTimes.length
      )
    : null;

  // Trend : new leads this month vs last month
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1).getTime();
  const lastMonthEnd = monthStart - 1;
  const leadsThisMonth = opps.filter(o => o.ghl_created_at && new Date(o.ghl_created_at).getTime() >= monthStart).length;
  const leadsLastMonth = opps.filter(o => {
    if (!o.ghl_created_at) return false;
    const t = new Date(o.ghl_created_at).getTime();
    return t >= lastMonthStart && t <= lastMonthEnd;
  }).length;
  const trend_leads_pct = leadsLastMonth > 0
    ? Math.round(((leadsThisMonth - leadsLastMonth) / leadsLastMonth) * 100)
    : null;

  return NextResponse.json({
    total,
    won_count,
    lost_count,
    in_progress_count: inProgress.length,
    conversion_global,
    avg_cycle_days: avgCycleDays,
    leads_this_month: leadsThisMonth,
    leads_last_month: leadsLastMonth,
    trend_leads_pct,
    stage_volume: stageVolume,
    stage_value: stageValue,
  });
}
