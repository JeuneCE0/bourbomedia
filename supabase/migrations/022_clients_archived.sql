-- Soft-delete des clients : "supprimer" un client retire la fiche du pipeline
-- onboarding (production) + de la liste clients, mais préserve l'opportunité
-- GHL liée et l'historique commercial.
-- archived_at NULL = visible. archived_at NOT NULL = retiré.

ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_clients_archived ON clients(archived_at);
