-- Link GHL opportunities to Bourbomedia clients so the client detail page can
-- surface the related closing call, opportunity name, monetary value, etc.
-- gh_appointments already has client_id (set by the webhook) — this aligns
-- gh_opportunities.

ALTER TABLE gh_opportunities
  ADD COLUMN IF NOT EXISTS client_id UUID REFERENCES clients(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_gh_opportunities_client ON gh_opportunities(client_id);

-- Backfill : match by ghl_contact_id first, then by email (case-insensitive)
UPDATE gh_opportunities o
SET client_id = c.id
FROM clients c
WHERE o.client_id IS NULL
  AND o.ghl_contact_id IS NOT NULL
  AND c.ghl_contact_id = o.ghl_contact_id;

UPDATE gh_opportunities o
SET client_id = c.id
FROM clients c
WHERE o.client_id IS NULL
  AND o.contact_email IS NOT NULL
  AND lower(o.contact_email) = lower(c.email);
