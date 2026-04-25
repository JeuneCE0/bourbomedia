-- GHL pipeline sync — adapts gh_appointments to mirror the "Pipeline Bourbon
-- Média" stages and stores enough context to push status changes back to GHL.

-- 1. New prospect_status values aligned with the GHL pipeline stages.
--    Drop the old constraint, rewrite with the new vocabulary.
ALTER TABLE gh_appointments DROP CONSTRAINT IF EXISTS gh_appointments_prospect_status_check;
ALTER TABLE gh_appointments ADD CONSTRAINT gh_appointments_prospect_status_check
  CHECK (
    prospect_status IN (
      'reflection',           -- En réflexion        (auto-task J+2)
      'ghosting',             -- Ghosting
      'follow_up',            -- Follow-up           (auto-task J+7)
      'awaiting_signature',   -- Attente signature + paiement → onboarding
      'contracted',           -- Contracté → onboarding
      'regular',              -- Client régulier
      'not_interested',       -- Pas intéressé (override manuel)
      'closed_lost'           -- Perdu (override manuel)
    ) OR prospect_status IS NULL
  );

-- 2. Opportunity & pipeline metadata — populated by the backfill endpoint
--    and by the appointment webhook (when GHL sends contactId we can resolve
--    the opportunity).
ALTER TABLE gh_appointments
  ADD COLUMN IF NOT EXISTS opportunity_id        TEXT,
  ADD COLUMN IF NOT EXISTS opportunity_name      TEXT,
  ADD COLUMN IF NOT EXISTS pipeline_id           TEXT,
  ADD COLUMN IF NOT EXISTS pipeline_stage_id     TEXT,
  ADD COLUMN IF NOT EXISTS pipeline_stage_name   TEXT;

CREATE INDEX IF NOT EXISTS idx_gh_appointments_opportunity ON gh_appointments(opportunity_id);
CREATE INDEX IF NOT EXISTS idx_gh_appointments_pipeline_stage ON gh_appointments(pipeline_stage_id);

-- 3. Seed the GHL pipeline stage mapping so the UI knows how to translate
--    GHL stage names to our prospect_status enum. Stored in app_settings
--    so the admin can adjust without a redeploy if GHL labels change.
INSERT INTO app_settings (key, value)
VALUES (
  'ghl_pipeline_mapping',
  '{
    "pipeline_name": "Pipeline Bourbon Média",
    "stages": {
      "En réflexion": "reflection",
      "Ghosting": "ghosting",
      "Follow-up": "follow_up",
      "Attente signature + paiement": "awaiting_signature",
      "Contracté": "contracted",
      "Client régulier": "regular"
    }
  }'::jsonb
)
ON CONFLICT (key) DO NOTHING;
