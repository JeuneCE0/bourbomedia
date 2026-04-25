-- NPS (Net Promoter Score) responses — separate from satisfaction_surveys so
-- we can track multiple NPS over a client's lifetime (e.g. one per project).

CREATE TABLE IF NOT EXISTS nps_responses (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  -- 0-10 NPS score
  score INT NOT NULL CHECK (score BETWEEN 0 AND 10),
  comment TEXT,
  -- Recommended NPS bucket: detractor (0-6) / passive (7-8) / promoter (9-10)
  bucket TEXT GENERATED ALWAYS AS (
    CASE
      WHEN score <= 6 THEN 'detractor'
      WHEN score <= 8 THEN 'passive'
      ELSE 'promoter'
    END
  ) STORED,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_nps_client ON nps_responses(client_id);
CREATE INDEX IF NOT EXISTS idx_nps_created ON nps_responses(created_at DESC);

ALTER TABLE nps_responses ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'nps_responses' AND policyname = 'service role full access') THEN
    CREATE POLICY "service role full access" ON nps_responses FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;

-- Track when we asked the client for an NPS (so the cron doesn't spam)
ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS nps_requested_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_script_reminder_at TIMESTAMPTZ;
