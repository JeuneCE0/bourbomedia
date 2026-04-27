-- Web Push subscriptions for PWA notifications.
-- Each admin device that opts in stores its endpoint + keys here ; the server
-- iterates this table to fanout pushes (paiement reçu, script validé, etc.).

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  user_agent TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  last_used_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_push_subscriptions_created ON push_subscriptions(created_at DESC);
