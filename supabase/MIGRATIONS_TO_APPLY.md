# Migrations Supabase à appliquer en prod

État au 2026-04-30. Les migrations ci-dessous ont été ajoutées au repo mais
n'ont **pas encore été appliquées** à la base de production. À copier-coller
dans le SQL editor Supabase (Project → SQL Editor → New query) dans l'ordre.

Toutes sont **idempotentes** (utilisent `IF NOT EXISTS` / `ADD COLUMN IF NOT
EXISTS` / `CREATE INDEX IF NOT EXISTS`) — re-exécution = no-op, pas de
duplication ni d'erreur.

---

## 025 — Tracking des reports d'appels GHL

Ajoute 3 colonnes à `gh_appointments` pour afficher le badge "Reporté" + la
date initiale quand un RDV est déplacé (par toi ou par le client).

```sql
ALTER TABLE gh_appointments
  ADD COLUMN IF NOT EXISTS rescheduled_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS previous_starts_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reschedule_count INT NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_gh_appointments_rescheduled
  ON gh_appointments(rescheduled_at)
  WHERE rescheduled_at IS NOT NULL;
```

**Sans ça** : le webhook `/api/webhooks/ghl/appointment` plante au prochain
report (les colonnes n'existent pas) et le badge "Reporté" reste invisible
sur `/dashboard` + `AppointmentDetailModal`.

---

## 026 — Lockout temporaire saas_users après échecs login

Ajoute `failed_login_count` + `locked_until` sur `saas_users` pour bloquer
un compte après N échecs consécutifs (couche anti-brute-force).

```sql
ALTER TABLE saas_users
  ADD COLUMN IF NOT EXISTS failed_login_count INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS locked_until TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_saas_users_locked_until
  ON saas_users(locked_until)
  WHERE locked_until IS NOT NULL;
```

**Sans ça** : `/api/auth` renvoie 500 au prochain login (le SELECT cherche
`failed_login_count` + `locked_until` qui n'existent pas).

---

## 027 — Error logs

Table pour persister les erreurs runtime côté client (`app/error.tsx`,
`app/global-error.tsx`) et serveur. Visualisation via `/dashboard/errors`.

```sql
CREATE TABLE IF NOT EXISTS error_logs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  source TEXT NOT NULL CHECK (source IN ('client', 'server')),
  digest TEXT,
  message TEXT,
  stack TEXT,
  url TEXT,
  user_agent TEXT,
  client_token_prefix TEXT,
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
```

**Sans ça** : les erreurs runtime ne sont plus persistées (mais
`/api/errors` ne plante pas — il fait un INSERT silencieux qui échoue
gracieusement).

---

## 028 — Funnel events

Table pour le tracking des étapes du parcours onboarding. Visualisation
via `/dashboard/funnel`.

```sql
CREATE TABLE IF NOT EXISTS funnel_events (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  event TEXT NOT NULL,
  client_id UUID REFERENCES clients(id) ON DELETE SET NULL,
  client_token_prefix TEXT,
  source TEXT NOT NULL CHECK (source IN ('portal', 'onboarding', 'admin', 'webhook')),
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
```

**Sans ça** : `/api/funnel` ne persiste rien et `/dashboard/funnel` reste
vide ("Aucun event tracé sur la période").

---

## 029 — Brief montage interne (admin)

Ajoute deux colonnes à `clients` pour stocker le brief montage rédigé
côté admin (onglet Montage de la fiche client) et son statut workflow
(`draft` → `in_progress` → `awaiting_review` → `done`).

```sql
ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS montage_notes TEXT,
  ADD COLUMN IF NOT EXISTS montage_status TEXT
    CHECK (montage_status IN ('draft', 'in_progress', 'awaiting_review', 'done'));
```

**Sans ça** : l'onglet Montage de la fiche client se charge en lecture
seule (les champs sont undefined côté API), et tout PUT vers
`/api/clients` qui inclut `montage_notes` / `montage_status` renvoie
une erreur Supabase ("column does not exist").

---

## Vérification post-application

Après les avoir collées dans Supabase SQL editor → **RUN**, tu peux
vérifier que tout est bien créé :

```sql
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN ('error_logs', 'funnel_events')
ORDER BY table_name;

SELECT column_name FROM information_schema.columns
WHERE table_name = 'gh_appointments'
  AND column_name IN ('rescheduled_at', 'previous_starts_at', 'reschedule_count');

SELECT column_name FROM information_schema.columns
WHERE table_name = 'saas_users'
  AND column_name IN ('failed_login_count', 'locked_until');

SELECT column_name FROM information_schema.columns
WHERE table_name = 'clients'
  AND column_name IN ('montage_notes', 'montage_status');
```

Tu dois voir 8 lignes au total (2 tables + 3 colonnes gh_appointments + 2
colonnes saas_users + 2 colonnes clients).

Si tu veux tester :
1. Va sur `/dashboard/errors` → tu dois voir "🎉 Aucune erreur récente"
   (au lieu d'une 500).
2. Va sur `/dashboard/funnel` → tu dois voir le sélecteur 7j/30j/90j
   et "Aucun event tracé sur la période" tant que rien n'est tracé.
3. Tente un login admin avec mauvais mot de passe 5 fois → la 6e
   tentative renvoie 423 Locked au lieu de 401.
