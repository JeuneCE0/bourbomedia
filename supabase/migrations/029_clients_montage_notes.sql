-- 029 : champ montage_notes + montage_status sur clients
-- Onglet "Montage" admin (mirror du tab Script) : brief / instructions
-- éditeur entre la fin du tournage et la livraison vidéo. montage_status
-- pilote le badge couleur dans l'UI (draft / in_progress / awaiting_review / done).
-- Idempotent (IF NOT EXISTS) — re-run safe.

ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS montage_notes TEXT,
  ADD COLUMN IF NOT EXISTS montage_status TEXT DEFAULT 'draft';

COMMENT ON COLUMN clients.montage_notes IS 'Brief montage : instructions pour l''éditeur vidéo (ton, structure, références, b-rolls, etc.)';
COMMENT ON COLUMN clients.montage_status IS 'État du brief montage : draft | in_progress | awaiting_review | done';
