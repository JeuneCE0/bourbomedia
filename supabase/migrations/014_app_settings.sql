-- Generic key/value settings store. Used for things that need to be editable
-- without a redeploy (monthly ads budget, etc.). Keep keys typed inside
-- lib/app-settings.ts.

CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE app_settings ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'app_settings' AND policyname = 'service role full access') THEN
    CREATE POLICY "service role full access" ON app_settings FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;

-- Seed default monthly ads budget at 0; admin sets the real value from the
-- Settings page. Stored in cents to match the rest of the codebase.
INSERT INTO app_settings (key, value)
VALUES ('ads_budget_monthly_cents', '0'::jsonb)
ON CONFLICT (key) DO NOTHING;
