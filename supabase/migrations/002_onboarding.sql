-- Onboarding flow for BourbonMédia clients
-- 7 steps: account → contract → payment → call → script → filming → publication

-- ============================================================
-- Add onboarding columns to clients table
-- ============================================================
ALTER TABLE clients ADD COLUMN IF NOT EXISTS onboarding_step INT DEFAULT 1;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS onboarding_token TEXT UNIQUE;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS password_hash TEXT;

-- Step 2: Contract
ALTER TABLE clients ADD COLUMN IF NOT EXISTS contract_yousign_id TEXT;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS contract_signature_link TEXT;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS contract_signed_at TIMESTAMPTZ;

-- Step 3: Payment
ALTER TABLE clients ADD COLUMN IF NOT EXISTS stripe_session_id TEXT;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS stripe_payment_id TEXT;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS payment_amount INT;

-- Step 4: Onboarding call
ALTER TABLE clients ADD COLUMN IF NOT EXISTS onboarding_call_booked BOOLEAN DEFAULT false;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS onboarding_call_date TIMESTAMPTZ;

-- Step 6: Filming date validation
ALTER TABLE clients ADD COLUMN IF NOT EXISTS filming_date_confirmed BOOLEAN DEFAULT false;

-- Step 7: Publication date validation
ALTER TABLE clients ADD COLUMN IF NOT EXISTS publication_date DATE;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS publication_date_confirmed BOOLEAN DEFAULT false;

-- ============================================================
-- Contract templates (optional: store contract PDFs)
-- ============================================================
CREATE TABLE IF NOT EXISTS contract_templates (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  file_url TEXT NOT NULL,
  file_base64 TEXT,
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE contract_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_all" ON contract_templates FOR ALL USING (true) WITH CHECK (true);

-- Index for onboarding token lookup
CREATE INDEX IF NOT EXISTS idx_clients_onboarding_token ON clients(onboarding_token);
