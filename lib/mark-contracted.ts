// Quand un paiement est reçu, on bascule automatiquement le prospect en
// stage "Contracté" :
//   - l'opportunité GHL liée (gh_opportunities.client_id = clientId) → push
//     du nouveau stage vers GHL (updateOpportunityStage)
//   - les appointments liés (gh_appointments.client_id) → status contracted +
//     notes_completed_at marqué + push du status GHL
// Tolère les erreurs : appelé en best effort depuis les webhooks Stripe et
// la sync manuelle.

import { supaFetch } from './supabase';
import { resolveMapping, prospectStatusToStageId, updateOpportunityStage } from './ghl-opportunities';

export async function markProspectContracted(clientId: string, clientEmail: string | null = null): Promise<{ opportunities_updated: number; appointments_updated: number }> {
  let opportunities_updated = 0;
  let appointments_updated = 0;

  try {
    const { mapping } = await resolveMapping();
    const target = prospectStatusToStageId(mapping, 'contracted');

    // 1. Opportunités : trouve toutes les opps liées à ce client (par client_id
    // ou par email comme fallback) et qui ne sont pas déjà 'contracted'/'regular'
    const matchPath = clientEmail
      ? `gh_opportunities?or=(client_id.eq.${clientId},contact_email.ilike.${encodeURIComponent(clientEmail.toLowerCase().trim())})`
      : `gh_opportunities?client_id=eq.${clientId}`;
    const oppsR = await supaFetch(
      `${matchPath}&prospect_status=not.in.(contracted,regular,closed_lost,not_interested)&select=id,ghl_opportunity_id,pipeline_id,prospect_status`,
      {}, true,
    );
    if (oppsR.ok) {
      const opps = await oppsR.json() as Array<{ id: string; ghl_opportunity_id: string; pipeline_id: string | null; prospect_status: string | null }>;
      for (const o of opps) {
        // Update local
        await supaFetch(`gh_opportunities?id=eq.${encodeURIComponent(o.id)}`, {
          method: 'PATCH',
          body: JSON.stringify({
            prospect_status: 'contracted',
            client_id: clientId,
            pipeline_stage_id: target.stageId || undefined,
            updated_at: new Date().toISOString(),
          }),
        }, true).catch(() => null);
        // Push to GHL pipeline (best effort)
        if (o.ghl_opportunity_id && target.pipelineId && target.stageId) {
          await updateOpportunityStage(o.ghl_opportunity_id, target.pipelineId, target.stageId).catch(() => null);
        }
        opportunities_updated++;
      }
    }

    // 2. Appointments : flip prospect_status + auto-document pour sortir des
    // listes "à traiter".
    const apptMatch = clientEmail
      ? `gh_appointments?or=(client_id.eq.${clientId},contact_email.ilike.${encodeURIComponent(clientEmail.toLowerCase().trim())})`
      : `gh_appointments?client_id=eq.${clientId}`;
    const apptsR = await supaFetch(
      `${apptMatch}&prospect_status=in.(awaiting_signature,reflection,follow_up,ghosting)&select=id,opportunity_id`,
      {}, true,
    );
    if (apptsR.ok) {
      const appts = await apptsR.json() as Array<{ id: string; opportunity_id: string | null }>;
      for (const a of appts) {
        await supaFetch(`gh_appointments?id=eq.${encodeURIComponent(a.id)}`, {
          method: 'PATCH',
          body: JSON.stringify({
            prospect_status: 'contracted',
            client_id: clientId,
            notes_completed_at: new Date().toISOString(),
            notes: '✅ Auto: paiement Stripe reçu — contrat finalisé',
            ghl_synced_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          }),
        }, true).catch(() => null);
        appointments_updated++;
      }
    }
  } catch { /* tolerate */ }

  return { opportunities_updated, appointments_updated };
}
