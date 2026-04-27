-- Add 'onboarding_call' to the production pipeline. Represents the phase
-- between "contract signed + paid" and "script writing starts" where the
-- client books and does an onboarding call with the team.

DO $$
BEGIN
  ALTER TABLE clients DROP CONSTRAINT IF EXISTS clients_status_check;
  ALTER TABLE clients ADD CONSTRAINT clients_status_check CHECK (status IN (
    'onboarding',
    'onboarding_call',
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
