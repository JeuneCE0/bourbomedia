-- Video review & publication scheduling.
--
-- New flow after the video is delivered:
--   1. Admin marks the video as delivered (delivered_at set)
--   2. Client reviews the video on the portal:
--        - "Valider la vidéo" → video_validated_at set
--        - "Demander des modifications" → video_changes_requested = true + comment
--   3. Once validated, client picks a publication date (Tue or Thu only)
--      → publication_deadline set + publication_date_confirmed = true
--   4. Date passes → admin marks status = 'published' (or auto via cron later)

ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS video_validated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS video_review_comment TEXT,
  ADD COLUMN IF NOT EXISTS video_changes_requested BOOLEAN DEFAULT false;

-- Add new statuses to the CHECK constraint without dropping data.
-- Two new states are added between 'editing' and 'published':
--   'video_review'        — video delivered, awaiting client validation
--   'publication_pending' — video validated, awaiting publication date pick

DO $$
BEGIN
  ALTER TABLE clients DROP CONSTRAINT IF EXISTS clients_status_check;
  ALTER TABLE clients ADD CONSTRAINT clients_status_check CHECK (status IN (
    'onboarding',
    'script_writing',
    'script_review',
    'script_validated',
    'filming_scheduled',
    'filming_done',
    'editing',
    'video_review',
    'publication_pending',
    'published'
  ));
END $$;
