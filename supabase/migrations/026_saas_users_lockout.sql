-- Lockout temporaire après échecs d'authentification successifs sur les
-- comptes équipe (saas_users). Complète le throttle 250-450ms posé dans
-- lib/auth.ts par un vrai blocage après N tentatives consécutives, pour
-- résister à un attaquant qui tournerait en parallèle sur plusieurs IPs.
--
-- Logique côté lib/auth.ts :
--  - À chaque login KO sur un email connu  → failed_login_count++
--  - Si >= 5 échecs consécutifs           → locked_until = now() + 15 min
--  - Login OK                             → reset compteur + clear lock
--  - Si locked_until > now()              → refus immédiat sans vérif pwd

ALTER TABLE saas_users
  ADD COLUMN IF NOT EXISTS failed_login_count INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS locked_until TIMESTAMPTZ;

-- Index partiel sur locked_until — utile si on veut un job qui purge les
-- locks expirés en batch (sinon ils sont juste ignorés au prochain login).
CREATE INDEX IF NOT EXISTS idx_saas_users_locked_until
  ON saas_users(locked_until)
  WHERE locked_until IS NOT NULL;
