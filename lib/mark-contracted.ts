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
import { pushNotesToGhl } from './ghl-appointments';

const CONTRACTED_NOTE = '✅ Auto: paiement Stripe reçu — contrat finalisé';

export async function markProspectContracted(clientId: string, clientEmail: string | null = null): Promise<{ opportunities_updated: number; appointments_updated: number; ghl_notes_pushed: number }> {
  let opportunities_updated = 0;
  let appointments_updated = 0;
  let ghl_notes_pushed = 0;
  const pushedContactIds = new Set<string>();

  try {
    const { mapping } = await resolveMapping();
    const target = prospectStatusToStageId(mapping, 'contracted');

    // 1. Opportunités : trouve toutes les opps liées à ce client (par client_id
    // ou par email comme fallback) et qui ne sont pas déjà 'contracted'/'regular'
    const matchPath = clientEmail
      ? `gh_opportunities?or=(client_id.eq.${clientId},contact_email.ilike.${encodeURIComponent(clientEmail.toLowerCase().trim())})`
      : `gh_opportunities?client_id=eq.${clientId}`;
    const oppsR = await supaFetch(
      `${matchPath}&prospect_status=not.in.(contracted,regular,closed_lost,not_interested)&select=id,ghl_opportunity_id,ghl_contact_id,pipeline_id,prospect_status`,
      {}, true,
    );
    if (oppsR.ok) {
      const opps = await oppsR.json() as Array<{ id: string; ghl_opportunity_id: string; ghl_contact_id: string | null; pipeline_id: string | null; prospect_status: string | null }>;
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
        // Push note + tag au contact GHL (dédup par contact)
        if (o.ghl_contact_id && !pushedContactIds.has(o.ghl_contact_id)) {
          const ok = await pushNotesToGhl(o.ghl_contact_id, CONTRACTED_NOTE, 'contracted').catch(() => false);
          if (ok) ghl_notes_pushed++;
          pushedContactIds.add(o.ghl_contact_id);
        }
        opportunities_updated++;
      }
    }

    // 2. Appointments : flip prospect_status + auto-document pour sortir des
    // listes "à traiter". Pousse aussi la note vers GHL si le contact n'a pas
    // déjà reçu (cas: opp sans ghl_contact_id mais appointment avec).
    const apptMatch = clientEmail
      ? `gh_appointments?or=(client_id.eq.${clientId},contact_email.ilike.${encodeURIComponent(clientEmail.toLowerCase().trim())})`
      : `gh_appointments?client_id=eq.${clientId}`;
    const apptsR = await supaFetch(
      `${apptMatch}&prospect_status=in.(awaiting_signature,reflection,follow_up,ghosting)&select=id,opportunity_id,ghl_contact_id`,
      {}, true,
    );
    if (apptsR.ok) {
      const appts = await apptsR.json() as Array<{ id: string; opportunity_id: string | null; ghl_contact_id: string | null }>;
      for (const a of appts) {
        await supaFetch(`gh_appointments?id=eq.${encodeURIComponent(a.id)}`, {
          method: 'PATCH',
          body: JSON.stringify({
            prospect_status: 'contracted',
            client_id: clientId,
            notes_completed_at: new Date().toISOString(),
            notes: CONTRACTED_NOTE,
            ghl_synced_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          }),
        }, true).catch(() => null);
        // Push note vers GHL si pas déjà fait via l'opp
        if (a.ghl_contact_id && !pushedContactIds.has(a.ghl_contact_id)) {
          const ok = await pushNotesToGhl(a.ghl_contact_id, CONTRACTED_NOTE, 'contracted').catch(() => false);
          if (ok) ghl_notes_pushed++;
          pushedContactIds.add(a.ghl_contact_id);
        }
        appointments_updated++;
      }
    }

    // 3. Filet de sécurité : si on n'a poussé sur AUCUN contact GHL (ex: tous
    // les RDV/opps déjà 'contracted' donc filtrés), on tente quand même via
    // clients.ghl_contact_id pour garantir que GHL reçoit la note.
    if (pushedContactIds.size === 0) {
      const clR = await supaFetch(
        `clients?id=eq.${encodeURIComponent(clientId)}&select=ghl_contact_id&limit=1`,
        {}, true,
      );
      if (clR.ok) {
        const arr = await clR.json();
        const ghlContactId = arr[0]?.ghl_contact_id;
        if (ghlContactId) {
          const ok = await pushNotesToGhl(ghlContactId, CONTRACTED_NOTE, 'contracted').catch(() => false);
          if (ok) ghl_notes_pushed++;
        }
      }
    }
  } catch { /* tolerate */ }

  return { opportunities_updated, appointments_updated, ghl_notes_pushed };
}
