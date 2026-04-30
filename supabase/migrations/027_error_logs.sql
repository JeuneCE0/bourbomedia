-- Error logs : capture les erreurs runtime côté client + serveur dans une
-- table Supabase. Remplace l'intégration Sentry pour cette première phase
-- (pas de dépendance externe, pas de DSN à configurer, visualisation
-- directement dans le dashboard admin via /dashboard/errors).
--
-- Le frontend POST sur /api/errors quand error.tsx ou global-error.tsx
-- catche un crash. Les erreurs serveur (route handlers) peuvent aussi
-- y poster via le helper logServerError() dans lib/error-log.ts.

CREATE TABLE IF NOT EXISTS error_logs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,

  -- "client" (React error boundary) ou "server" (route handler).
  source TEXT NOT NULL CHECK (source IN ('client', 'server')),

  -- Identifiant Next.js (digest) ou message court de l'erreur.
  digest TEXT,
  message TEXT,
  stack TEXT,

  -- URL où l'erreur s'est produite (côté client) ou route (côté server).
  url TEXT,
  user_agent TEXT,

  -- Token client (portal_token) si l'erreur s'est produite sur le portail
  -- pour qu'on puisse retrouver le client concerné. Anonymisé via préfixe.
  client_token_prefix TEXT,

  -- Payload arbitraire pour métadonnées (status code, request body en
  -- redacted, etc.). Limité à 8 KB par insert via la check ci-dessous.
  metadata JSONB,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT error_logs_metadata_size CHECK (octet_length(metadata::text) < 8192)
);

CREATE INDEX IF NOT EXISTS idx_error_logs_created
  ON error_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_error_logs_source_created
  ON error_logs(source, created_at DESC);

ALTER TABLE error_logs ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'error_logs' AND policyname = 'service role full access') THEN
    CREATE POLICY "service role full access" ON error_logs FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;
