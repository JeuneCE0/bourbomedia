-- Inline annotations on scripts (Google-Docs-style highlight + comment).
--
-- Stored separately from script_comments so the chat thread stays clean and
-- annotations carry a persistent highlight + status. The frontend also has a
-- graceful fallback: if this table is missing, annotations are encoded inside
-- script_comments.content as JSON so the feature still works.

CREATE TABLE IF NOT EXISTS script_annotations (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  script_id UUID NOT NULL REFERENCES scripts(id) ON DELETE CASCADE,
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  -- The text the client highlighted (plain text snapshot — survives edits)
  quote TEXT NOT NULL,
  -- Optional ProseMirror positions (best-effort; quote is the source of truth)
  pos_from INT,
  pos_to INT,
  -- The client's note about that selection
  note TEXT NOT NULL,
  author_type TEXT NOT NULL DEFAULT 'client' CHECK (author_type IN ('client', 'admin')),
  author_name TEXT,
  resolved BOOLEAN NOT NULL DEFAULT false,
  resolved_at TIMESTAMPTZ,
  -- Script version this annotation was made against (lets admin know if it's stale)
  script_version INT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_script_annotations_script ON script_annotations(script_id);
CREATE INDEX IF NOT EXISTS idx_script_annotations_client ON script_annotations(client_id);
CREATE INDEX IF NOT EXISTS idx_script_annotations_unresolved ON script_annotations(script_id) WHERE resolved = false;

-- Allow service role full access (RLS is intentionally permissive — auth is handled at the API layer via portal_token / admin token).
ALTER TABLE script_annotations ENABLE ROW LEVEL SECURITY;
CREATE POLICY IF NOT EXISTS "service role full access" ON script_annotations FOR ALL USING (true) WITH CHECK (true);
