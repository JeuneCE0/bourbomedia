-- Tracking des reports d'appels (admin ou client) sur les rendez-vous GHL.
--
-- GHL renvoie le même appointment_id quand le créneau est déplacé (côté client
-- ou côté admin). Le webhook /api/webhooks/ghl/appointment compare le
-- starts_at entrant au starts_at existant ; si différent, il pose ces colonnes
-- pour qu'on affiche un badge "Reporté" + l'ancienne date dans le dashboard.

ALTER TABLE gh_appointments
  ADD COLUMN IF NOT EXISTS rescheduled_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS previous_starts_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reschedule_count INT NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_gh_appointments_rescheduled
  ON gh_appointments(rescheduled_at)
  WHERE rescheduled_at IS NOT NULL;
