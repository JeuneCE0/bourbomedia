-- Dédup colonnes pour les relances temporelles automatisées par
-- /api/cron/reminders. Le cron tourne tous les jours ouvrés 7h
-- (vercel.json), et déclenche un workflow GHL via tag dès qu'un
-- client est bloqué à une étape "tiède". Sans ces colonnes, on
-- ne saurait pas qu'on a déjà spammé le client, et le tag GHL
-- serait re-posé chaque matin → spam WhatsApp / SMS.
--
-- Convention : on garde la timestamp du dernier envoi par type de
-- relance et on bloque pendant 7 jours pour ne re-pinger qu'une
-- fois par semaine max (le cron lui-même vérifie aussi que le
-- blocage est toujours d'actualité, ex: contract_signed_at NOT NULL
-- AND paid_at NULL avant de re-spammer paiement).
--
-- last_script_reminder_at existait déjà (migration 010_nps_responses).

ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS last_payment_reminder_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_video_review_reminder_at TIMESTAMPTZ;
