-- Filming day: checklist + photos + notes
ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS filming_checklist JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS filming_photos JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS filming_notes TEXT;
