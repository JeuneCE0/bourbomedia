import { NextRequest, NextResponse } from 'next/server';
import { supaFetch } from '@/lib/supabase';
import { notifyClientStatusChange, notifyTaskDeadline, sendSlackNotification } from '@/lib/slack';
import { triggerWorkflow } from '@/lib/ghl-workflows';

interface TodoItem {
  id: string;
  text: string;
  done: boolean;
  due_date?: string;
}

interface CronClient {
  id: string;
  business_name: string;
  contact_name: string;
  status: string;
  updated_at?: string;
  created_at: string;
  filming_date?: string;
  delivered_at?: string;
  ghl_contact_id?: string;
  portal_token?: string;
  nps_requested_at?: string;
  last_script_reminder_at?: string;
}

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const summary = {
    checked: 0,
    alerts: [] as string[],
    nps_sent: 0,
    script_reminders_sent: 0,
  };

  try {
    const r = await supaFetch(
      'clients?status=neq.published&select=id,business_name,contact_name,status,updated_at,created_at,filming_date,delivered_at,ghl_contact_id,portal_token,nps_requested_at,last_script_reminder_at',
      {}, true,
    );
    if (!r.ok) return NextResponse.json({ error: 'Failed to fetch clients' }, { status: 500 });

    const clients: CronClient[] = await r.json();
    const now = Date.now();
    const todayIso = new Date().toISOString();
    summary.checked = clients.length;

    for (const c of clients) {
      const lastMs = c.updated_at ? new Date(c.updated_at).getTime() : new Date(c.created_at).getTime();
      const daysIdle = Math.floor((now - lastMs) / 86400000);

      // ── Existing alerts ──
      if (c.status === 'script_review' && daysIdle > 3) {
        summary.alerts.push(`⏳ ${c.business_name} — script en relecture depuis ${daysIdle} j`);
        notifyClientStatusChange(c.business_name, c.status, `Script en relecture depuis ${daysIdle} jours — relance recommandée`);

        // Auto-pilot: ping the client via GHL workflow (dedupe via last_script_reminder_at,
        // re-fires every 7 days max)
        const lastReminderMs = c.last_script_reminder_at ? new Date(c.last_script_reminder_at).getTime() : 0;
        const reminderDaysSince = Math.floor((now - lastReminderMs) / 86400000);
        if (daysIdle >= 4 && (reminderDaysSince >= 7 || lastReminderMs === 0)) {
          await triggerWorkflow(c.ghl_contact_id || null, 'script_changes_requested').catch(() => null);
          // Best-effort persist (column may not exist if migration 010 not applied yet)
          try {
            await supaFetch(`clients?id=eq.${c.id}`, {
              method: 'PATCH',
              body: JSON.stringify({ last_script_reminder_at: todayIso }),
            }, true);
          } catch { /* migration not applied yet */ }
          summary.script_reminders_sent++;
        }
      } else if (daysIdle > 14) {
        summary.alerts.push(`🔴 ${c.business_name} — aucune activité depuis ${daysIdle} j`);
        notifyClientStatusChange(c.business_name, c.status, `Aucune activité depuis ${daysIdle} jours`);
      }

      if (c.filming_date) {
        const daysToFilming = Math.ceil((new Date(c.filming_date).getTime() - now) / 86400000);
        if (daysToFilming >= 0 && daysToFilming <= 2 && c.status !== 'filming_done' && c.status !== 'editing') {
          const label = daysToFilming === 0 ? "aujourd'hui" : daysToFilming === 1 ? 'demain' : `dans ${daysToFilming} j`;
          summary.alerts.push(`🎬 ${c.business_name} — tournage ${label}`);
          notifyClientStatusChange(c.business_name, c.status, `Tournage ${label}`);
          // Trigger filming_reminder workflow when tournage = demain
          if (daysToFilming === 1) {
            await triggerWorkflow(c.ghl_contact_id || null, 'filming_reminder').catch(() => null);
          }
        }
      }

      // ── NPS J+7 after delivery (skip if already requested) ──
      if (c.delivered_at && !c.nps_requested_at) {
        const daysSinceDelivery = Math.floor((now - new Date(c.delivered_at).getTime()) / 86400000);
        if (daysSinceDelivery >= 7 && daysSinceDelivery <= 60) {
          await triggerWorkflow(c.ghl_contact_id || null, 'feedback_requested').catch(() => null);
          try {
            await supaFetch(`clients?id=eq.${c.id}`, {
              method: 'PATCH',
              body: JSON.stringify({ nps_requested_at: todayIso }),
            }, true);
          } catch { /* migration not applied yet */ }
          summary.nps_sent++;
          summary.alerts.push(`📨 NPS demandé à ${c.business_name} (livré il y a ${daysSinceDelivery}j)`);
        }
      }
    }

    // ── Task deadline reminders (existing) ──
    const tr = await supaFetch('clients?select=id,business_name,todos&todos=not.eq.[]', {}, true);
    if (tr.ok) {
      const clientsWithTodos = await tr.json();
      const todayStr = new Date().toISOString().slice(0, 10);
      for (const ct of clientsWithTodos) {
        const todos: TodoItem[] = Array.isArray(ct.todos) ? ct.todos : [];
        for (const t of todos) {
          if (t.done || !t.due_date) continue;
          if (t.due_date <= todayStr) {
            summary.alerts.push(`⏰ ${ct.business_name} — tâche en retard: ${t.text.slice(0, 60)}`);
            notifyTaskDeadline(ct.business_name, t.text, t.due_date);
          }
        }
      }
    }

    // ── Daily Slack summary ──
    if (summary.alerts.length > 0) {
      const blocks = [
        { type: 'header', text: { type: 'plain_text', text: '🌅 Résumé matinal Bourbomedia', emoji: true } },
        { type: 'section', fields: [
          { type: 'mrkdwn', text: `*Clients vérifiés:*\n${summary.checked}` },
          { type: 'mrkdwn', text: `*Alertes:*\n${summary.alerts.length}` },
          { type: 'mrkdwn', text: `*NPS envoyés:*\n${summary.nps_sent}` },
          { type: 'mrkdwn', text: `*Relances scripts:*\n${summary.script_reminders_sent}` },
        ]},
        { type: 'section', text: { type: 'mrkdwn', text: summary.alerts.slice(0, 12).map(a => `• ${a}`).join('\n') } },
      ];
      await sendSlackNotification({ text: '🌅 Résumé matinal Bourbomedia', blocks }).catch(() => null);
    }

    return NextResponse.json(summary);
  } catch (e: unknown) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
