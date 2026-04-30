-- Funnel events : tracking des étapes du parcours onboarding pour
-- mesurer les taux de conversion et identifier les drop-offs.
--
-- Contrairement à Plausible/PostHog (services externes), on garde tout en
-- DB Supabase pour pas dépendre d'un tiers + RGPD-friendly (les events
-- restent sur l'infra du SaaS, pas chez Cloudflare/Heroku/etc.).
--
-- Le frontend POST sur /api/funnel?event=... avec le portal_token (pour
-- corréler au client) ; chaque event est immutable une fois inséré.
-- Une vue d'agrégation matérialisée pourra suivre dans une migration
-- ultérieure si on veut un dashboard rapide (count par event par jour).

CREATE TABLE IF NOT EXISTS funnel_events (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,

  -- Nom de l'événement (snake_case, vocabulaire fixe côté code).
  -- Ex: 'onboarding_landed', 'signup_completed', 'contract_signed',
  --     'payment_completed', 'call_booked', 'script_validated',
  --     'filming_booked', 'video_validated', 'publication_booked'.
  event TEXT NOT NULL,

  -- Optionnel : client_id si on peut le résoudre côté API (via portal_token).
  -- Permet de joindre avec clients pour cohorter par catégorie / ville / etc.
  client_id UUID REFERENCES clients(id) ON DELETE SET NULL,

  -- Préfixe du portal_token (8 chars) pour anonymiser tout en permettant
  -- de corréler plusieurs events d'un même client (ex: signup + contract +
  -- payment du même portal_token doivent matcher).
  client_token_prefix TEXT,

  -- Source du tracking : 'portal' (depuis /portal/* côté client),
  -- 'onboarding' (depuis /onboarding signup), 'admin' (action admin
  -- dans le dashboard qui équivaut à un event), 'webhook' (depuis un
  -- webhook tiers).
  source TEXT NOT NULL CHECK (source IN ('portal', 'onboarding', 'admin', 'webhook')),

  -- Métadonnées libres (page courante, durée passée, etc.) — limitées en
  -- taille pour ne pas faire fuir la table.
  metadata JSONB,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT funnel_events_metadata_size CHECK (octet_length(metadata::text) < 4096)
);

CREATE INDEX IF NOT EXISTS idx_funnel_events_event_created
  ON funnel_events(event, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_funnel_events_client
  ON funnel_events(client_id, created_at DESC)
  WHERE client_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_funnel_events_token_prefix
  ON funnel_events(client_token_prefix, created_at DESC)
  WHERE client_token_prefix IS NOT NULL;

ALTER TABLE funnel_events ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'funnel_events' AND policyname = 'service role full access') THEN
    CREATE POLICY "service role full access" ON funnel_events FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;
