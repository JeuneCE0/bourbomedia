-- Provider fees per client + daily business metrics.

-- Per-client provider costs (filmmaker, editor, voice-over, etc.)
ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS provider_fees JSONB NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN clients.provider_fees IS
'Array of {id, type, amount_cents, description, paid_at, created_at}.
type ∈ {filmmaker, editor, voiceover, other}.';

-- Daily metrics — one row per day, used by the admin dashboard for the
-- "today / this week" KPI band: ads spend, calls booked, calls closed.
CREATE TABLE IF NOT EXISTS daily_metrics (
  date DATE PRIMARY KEY,
  ads_budget_cents INT NOT NULL DEFAULT 0,
  calls_booked INT NOT NULL DEFAULT 0,
  calls_closed INT NOT NULL DEFAULT 0,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE daily_metrics ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'daily_metrics' AND policyname = 'service role full access') THEN
    CREATE POLICY "service role full access" ON daily_metrics FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;
