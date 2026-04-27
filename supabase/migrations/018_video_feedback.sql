-- Per-video timestamped feedback (Frame.io-lite). The client can pin a
-- comment to a specific second of the delivered video while reviewing it.
-- Each entry: { id, time_seconds, comment, author, created_at, resolved? }

ALTER TABLE videos
  ADD COLUMN IF NOT EXISTS feedback JSONB NOT NULL DEFAULT '[]'::jsonb;
