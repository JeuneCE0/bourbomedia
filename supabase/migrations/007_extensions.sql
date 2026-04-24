-- Migration 007 — Tags, todos, satisfaction, notifications, multi-videos, invoices
-- ============================================================
-- Client extras: tags + todos + document URLs
-- ============================================================
ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS tags TEXT[] DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS todos JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS contract_pdf_url TEXT;

CREATE INDEX IF NOT EXISTS idx_clients_tags ON clients USING GIN (tags);

-- ============================================================
-- Payments: Stripe invoice/receipt fields
-- ============================================================
ALTER TABLE payments
  ADD COLUMN IF NOT EXISTS receipt_url TEXT,
  ADD COLUMN IF NOT EXISTS invoice_pdf_url TEXT,
  ADD COLUMN IF NOT EXISTS invoice_number TEXT;

-- ============================================================
-- Satisfaction surveys (post-delivery)
-- ============================================================
CREATE TABLE IF NOT EXISTS satisfaction_surveys (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  rating INT NOT NULL CHECK (rating >= 1 AND rating <= 5),
  comment TEXT,
  allow_testimonial BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(client_id)
);

CREATE INDEX IF NOT EXISTS idx_satisfaction_client ON satisfaction_surveys(client_id);
ALTER TABLE satisfaction_surveys ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_all" ON satisfaction_surveys FOR ALL USING (true) WITH CHECK (true);

-- ============================================================
-- Client notifications (in-portal bell)
-- ============================================================
CREATE TABLE IF NOT EXISTS client_notifications (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT,
  link TEXT,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_client_notifications_client ON client_notifications(client_id, created_at DESC);
ALTER TABLE client_notifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_all" ON client_notifications FOR ALL USING (true) WITH CHECK (true);

-- ============================================================
-- Videos (multi-video support per client)
-- ============================================================
CREATE TABLE IF NOT EXISTS videos (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  title TEXT,
  video_url TEXT NOT NULL,
  thumbnail_url TEXT,
  delivery_notes TEXT,
  status TEXT DEFAULT 'delivered' CHECK (status IN ('draft', 'delivered')),
  delivered_at TIMESTAMPTZ DEFAULT now(),
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_videos_client ON videos(client_id, created_at DESC);
ALTER TABLE videos ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_all" ON videos FOR ALL USING (true) WITH CHECK (true);

-- Migrate existing single-video deliveries to videos table (backfill)
INSERT INTO videos (client_id, video_url, thumbnail_url, delivery_notes, status, delivered_at, created_at)
SELECT id, video_url, video_thumbnail_url, delivery_notes, 'delivered', delivered_at, COALESCE(delivered_at, updated_at)
FROM clients
WHERE video_url IS NOT NULL AND video_url <> ''
  AND NOT EXISTS (SELECT 1 FROM videos v WHERE v.client_id = clients.id);
