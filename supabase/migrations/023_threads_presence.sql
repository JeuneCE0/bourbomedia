-- Threads internes par prospect / client + presence indicator
--
-- internal_threads : commentaires entre admins (Rudy ↔ Siméon) attachés à
--   un client local (clients.id) ou à une opportunité GHL (gh_opportunity_id).
--   Pas visible côté portail client — purement interne.
--
-- presence : tracking live "qui regarde quoi". Ping toutes les 15s côté
--   client, expirie à 30s. Permet d'afficher 🟢 Rudy regarde cette fiche.

CREATE TABLE IF NOT EXISTS internal_threads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scope_type TEXT NOT NULL CHECK (scope_type IN ('client', 'opportunity')),
  scope_id TEXT NOT NULL,                    -- client uuid OU ghl_opportunity_id
  author_id TEXT,                             -- user.id si dispo (peut être null pour le seed)
  author_name TEXT NOT NULL,                  -- nom affiché (Rudy, Siméon…)
  body TEXT NOT NULL,
  mentions TEXT[],                            -- ['Rudy', 'Siméon'] pour notifications futures
  created_at TIMESTAMPTZ DEFAULT now(),
  edited_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_internal_threads_scope
  ON internal_threads(scope_type, scope_id, created_at DESC);

CREATE TABLE IF NOT EXISTS presence (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,                      -- identifiant admin (auth user id ou nom)
  user_name TEXT NOT NULL,                    -- pour affichage immédiat
  scope TEXT NOT NULL,                        -- 'client/<id>' | 'opportunity/<ghl_id>' | 'pipeline'
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (user_id, scope)
);

CREATE INDEX IF NOT EXISTS idx_presence_scope_updated
  ON presence(scope, updated_at DESC);
