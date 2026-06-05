-- Transcript d'appel + brouillon IA sur gh_appointments.
--
-- Objectif : automatiser la corvée #1 de Siméon (closer) — documenter chaque
-- appel à la main. Un transcript (Plaud, collage manuel, ou tout webhook
-- transcript_ready) arrive via POST /api/appointments/transcript, on le stocke
-- ici puis Claude pré-rédige des notes structurées + un statut prospect
-- suggéré. Siméon n'a plus qu'à relire/ajuster et enregistrer.
--
-- Choix de design : le transcript et le brouillon IA vivent dans des colonnes
-- séparées de `notes` / `prospect_status`. `notes` reste la source de vérité
-- humaine (posée au save explicite, c'est elle qui remonte en GHL). Le
-- brouillon est une proposition, jamais poussée telle quelle — on n'écrase
-- jamais ce que Siméon a tapé.

ALTER TABLE gh_appointments
  ADD COLUMN IF NOT EXISTS transcript            TEXT,
  ADD COLUMN IF NOT EXISTS transcript_source     TEXT,        -- 'plaud' | 'paste' | 'zapier' | 'whisper' | 'api'
  ADD COLUMN IF NOT EXISTS transcript_external_id TEXT,       -- id de l'enregistrement source (Plaud) → idempotence
  ADD COLUMN IF NOT EXISTS transcript_received_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS ai_draft              TEXT,        -- notes structurées générées par Claude
  ADD COLUMN IF NOT EXISTS ai_suggested_status   TEXT,        -- prospect_status proposé (même vocabulaire que migration 015)
  ADD COLUMN IF NOT EXISTS ai_drafted_at         TIMESTAMPTZ;

-- Idempotence des webhooks de transcript : un même enregistrement source ne
-- doit pas créer deux ingestions (retry Zapier, double-fire). Index partiel
-- unique sur l'external_id quand il est présent.
CREATE UNIQUE INDEX IF NOT EXISTS idx_gh_appointments_transcript_ext
  ON gh_appointments(transcript_external_id)
  WHERE transcript_external_id IS NOT NULL;
