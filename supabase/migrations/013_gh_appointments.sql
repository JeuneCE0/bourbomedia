-- GHL appointments mirror — receives webhook events from the user's GHL
-- account (closing call, onboarding call, tournage). Powers the
-- "📞 Appels à documenter" panel on the admin dashboard.

CREATE TABLE IF NOT EXISTS gh_appointments (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,

  -- GHL identifiers
  ghl_appointment_id TEXT UNIQUE NOT NULL,
  ghl_calendar_id TEXT NOT NULL,
  ghl_contact_id TEXT,

  -- Calendar kind (derived from calendar_id at webhook time)
  calendar_kind TEXT NOT NULL DEFAULT 'other'
    CHECK (calendar_kind IN ('closing', 'onboarding', 'tournage', 'other')),

  -- Lifecycle
  status TEXT NOT NULL DEFAULT 'scheduled'
    CHECK (status IN ('scheduled', 'completed', 'cancelled', 'no_show')),
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ,

  -- Cached contact info for matching + display
  contact_email TEXT,
  contact_phone TEXT,
  contact_name TEXT,

  -- Match to a Bourbomedia client (resolved at webhook time, can stay null)
  client_id UUID REFERENCES clients(id) ON DELETE SET NULL,

  -- Admin's notes after the call
  notes TEXT,
  notes_completed_at TIMESTAMPTZ,

  -- Quick prospect status (set when admin documents the call)
  prospect_status TEXT
    CHECK (prospect_status IN ('interested', 'to_follow_up', 'closed_won', 'closed_lost', 'not_interested') OR prospect_status IS NULL),

  -- Tracking
  reminded_at TIMESTAMPTZ,         -- last time we pinged Simeon
  ghl_synced_at TIMESTAMPTZ,       -- last time we pushed notes back to GHL
  raw_payload JSONB,               -- store the original webhook payload for debugging
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_gh_appointments_status ON gh_appointments(status);
CREATE INDEX IF NOT EXISTS idx_gh_appointments_starts ON gh_appointments(starts_at DESC);
CREATE INDEX IF NOT EXISTS idx_gh_appointments_pending ON gh_appointments(status, notes_completed_at)
  WHERE status = 'completed' AND notes_completed_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_gh_appointments_client ON gh_appointments(client_id);

ALTER TABLE gh_appointments ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'gh_appointments' AND policyname = 'service role full access') THEN
    CREATE POLICY "service role full access" ON gh_appointments FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;
