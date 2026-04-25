-- Mirror of GHL opportunities living in the "Pipeline Bourbon Media".
-- Lets us compute lead-funnel metrics (leads in / booking rate / attendance
-- rate / closing rate / pipeline value) without re-querying GHL each time.

CREATE TABLE IF NOT EXISTS gh_opportunities (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,

  ghl_opportunity_id TEXT UNIQUE NOT NULL,
  ghl_contact_id TEXT,
  pipeline_id TEXT NOT NULL,
  pipeline_stage_id TEXT NOT NULL,
  pipeline_stage_name TEXT,

  name TEXT,
  contact_email TEXT,
  contact_phone TEXT,
  contact_name TEXT,

  -- Monetary value as set in GHL (cents, EUR). Falls back to standard
  -- 500€ HT when summed if NULL.
  monetary_value_cents INTEGER,

  -- Mirrors gh_appointments.prospect_status when applicable (post-call stages).
  -- For pre-call stages (Leads, Appel réservé), this stays NULL.
  prospect_status TEXT,

  -- GHL timestamps (kept original to compute "new leads in period")
  ghl_created_at TIMESTAMPTZ,
  ghl_updated_at TIMESTAMPTZ,

  raw_payload JSONB,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_gh_opportunities_stage ON gh_opportunities(pipeline_stage_id);
CREATE INDEX IF NOT EXISTS idx_gh_opportunities_created ON gh_opportunities(ghl_created_at DESC);
CREATE INDEX IF NOT EXISTS idx_gh_opportunities_contact ON gh_opportunities(ghl_contact_id);

ALTER TABLE gh_opportunities ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'gh_opportunities' AND policyname = 'service role full access') THEN
    CREATE POLICY "service role full access" ON gh_opportunities FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;
