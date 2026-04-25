-- Threaded replies on script annotations.
-- Replies stay inline on the parent annotation as a JSONB array (no extra
-- table = no extra fetch). Each reply has: id, author_type, author_name,
-- text, created_at.

ALTER TABLE script_annotations
  ADD COLUMN IF NOT EXISTS replies JSONB NOT NULL DEFAULT '[]'::jsonb;
