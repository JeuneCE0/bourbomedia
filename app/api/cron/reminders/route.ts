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
  // Étapes "tièdes" qu'on monitore pour relancer automatiquement le client
  // via workflow GHL (tag → WhatsApp/SMS). Dédup par colonne *_reminder_at,
  // une seule relance par semaine max (cf migration 030).
  contract_signed_at?: string;
  paid_at?: string;
  last_payment_reminder_at?: string;
  video_validated_at?: string;
  video_changes_requested?: boolean;
  last_video_review_reminder_at?: string;
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
    payment_reminders_sent: 0,
    script_validation_reminders_sent: 0,
    video_review_reminders_sent: 0,
  };

  try {
    const r = await supaFetch(
      'clients?status=neq.published&archived_at=is.null'
      + '&select=id,business_name,contact_name,status,updated_at,created_at,filming_date,delivered_at,ghl_contact_id,portal_token,'
      + 'nps_requested_at,last_script_reminder_at,'
      + 'contract_signed_at,paid_at,last_payment_reminder_at,'
      + 'video_validated_at,video_changes_requested,last_video_review_reminder_at',
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

      // ── Relance paiement : contrat signé MAIS paiement non reçu depuis 24h ──
      // Pose le tag GHL bbm_payment_pending_24h sur le contact. L'envoi
      // effectif du WhatsApp/SMS est géré par un workflow GHL côté admin
      // (Contact Tag Added → Send WhatsApp). Re-fire 1× par semaine max
      // via last_payment_reminder_at. Stop dès que paid_at est posé.
      if (c.contract_signed_at && !c.paid_at) {
        const hoursSinceSign = (now - new Date(c.contract_signed_at).getTime()) / 3_600_000;
        const lastReminderMs = c.last_payment_reminder_at ? new Date(c.last_payment_reminder_at).getTime() : 0;
        const daysSinceLastReminder = lastReminderMs ? Math.floor((now - lastReminderMs) / 86400000) : 999;
        if (hoursSinceSign >= 24 && daysSinceLastReminder >= 7) {
          await triggerWorkflow(c.ghl_contact_id || null, 'payment_pending_24h').catch(() => null);
          try {
            await supaFetch(`clients?id=eq.${c.id}`, {
              method: 'PATCH',
              body: JSON.stringify({ last_payment_reminder_at: todayIso }),
            }, true);
          } catch { /* migration 030 not applied yet */ }
          summary.payment_reminders_sent++;
          summary.alerts.push(`💳 ${c.business_name} — paiement en attente depuis ${Math.floor(hoursSinceSign / 24)} j → relance auto`);
        }
      }

      // ── Relance validation script : status=script_review depuis 24h+
      // sans avoir validé ni annoté. Diffère du bloc "script_review J+3"
      // plus haut : ici on tape plus tôt (24h) avec un ton plus doux
      // ("as-tu eu le temps de relire ?") via le tag dédié, AVANT de
      // basculer sur la relance modifs J+4 du bloc précédent.
      // Proxy "stuck since" : updated_at (le PATCH qui pose status=
      // script_review bump updated_at). Dédup via last_script_reminder_at
      // partagé — on évite de doubler les pings en moins d'une semaine.
      if (c.status === 'script_review') {
        const hoursIdle = (now - lastMs) / 3_600_000;
        const lastReminderMs = c.last_script_reminder_at ? new Date(c.last_script_reminder_at).getTime() : 0;
        const daysSinceLastReminder = lastReminderMs ? Math.floor((now - lastReminderMs) / 86400000) : 999;
        if (hoursIdle >= 24 && hoursIdle < 96 && daysSinceLastReminder >= 7) {
          // 24h ≤ X < 96h : on évite de chevaucher avec le bloc ≥4j
          // script_changes_requested déjà géré plus haut.
          await triggerWorkflow(c.ghl_contact_id || null, 'script_validation_pending_24h').catch(() => null);
          try {
            await supaFetch(`clients?id=eq.${c.id}`, {
              method: 'PATCH',
              body: JSON.stringify({ last_script_reminder_at: todayIso }),
            }, true);
          } catch { /* migration not applied yet */ }
          summary.script_validation_reminders_sent++;
          summary.alerts.push(`📜 ${c.business_name} — script à relire depuis ${Math.floor(hoursIdle)}h → relance auto`);
        }
      }

      // ── Relance review vidéo : livrée depuis 48h sans validation ni
      // demande de modifs. On tag bbm_video_review_pending_48h pour
      // déclencher un WhatsApp "on attend votre retour sur la vidéo".
      // Stop dès que video_validated_at est posé ou video_changes_requested
      // = true (le client a réagi, dans un sens ou l'autre).
      if (c.delivered_at && !c.video_validated_at && !c.video_changes_requested) {
        const hoursSinceDelivery = (now - new Date(c.delivered_at).getTime()) / 3_600_000;
        const lastReminderMs = c.last_video_review_reminder_at ? new Date(c.last_video_review_reminder_at).getTime() : 0;
        const daysSinceLastReminder = lastReminderMs ? Math.floor((now - lastReminderMs) / 86400000) : 999;
        if (hoursSinceDelivery >= 48 && daysSinceLastReminder >= 7) {
          await triggerWorkflow(c.ghl_contact_id || null, 'video_review_pending_48h').catch(() => null);
          try {
            await supaFetch(`clients?id=eq.${c.id}`, {
              method: 'PATCH',
              body: JSON.stringify({ last_video_review_reminder_at: todayIso }),
            }, true);
          } catch { /* migration 030 not applied yet */ }
          summary.video_review_reminders_sent++;
          summary.alerts.push(`🎥 ${c.business_name} — vidéo livrée sans retour depuis ${Math.floor(hoursSinceDelivery / 24)} j → relance auto`);
        }
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
          { type: 'mrkdwn', text: `*Relances scripts (modifs):*\n${summary.script_reminders_sent}` },
          { type: 'mrkdwn', text: `*Relances paiement:*\n${summary.payment_reminders_sent}` },
          { type: 'mrkdwn', text: `*Relances script (à valider):*\n${summary.script_validation_reminders_sent}` },
          { type: 'mrkdwn', text: `*Relances review vidéo:*\n${summary.video_review_reminders_sent}` },
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
