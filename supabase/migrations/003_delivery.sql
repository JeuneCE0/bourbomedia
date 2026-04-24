-- Delivery fields for client video
ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS video_url TEXT,
  ADD COLUMN IF NOT EXISTS video_thumbnail_url TEXT,
  ADD COLUMN IF NOT EXISTS delivery_notes TEXT,
  ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMPTZ;

-- Optional: timeline events for audit/history
CREATE TABLE IF NOT EXISTS client_events (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  payload JSONB,
  actor TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_client_events_client ON client_events(client_id, created_at DESC);

ALTER TABLE client_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_all" ON client_events FOR ALL USING (true) WITH CHECK (true);
