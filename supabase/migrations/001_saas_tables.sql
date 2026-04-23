-- SaaS tables for BourbonMédia platform
-- saas_users: admin team members (manual creation by admin)
-- clients: businesses being served (1 client = 1 commerce)
-- scripts: video scripts (1 per client, rich text via Tiptap)
-- script_comments: client/admin comments on scripts
-- script_versions: version history for scripts

-- ============================================================
-- SAAS USERS (admin team access)
-- ============================================================
CREATE TABLE IF NOT EXISTS saas_users (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'editor' CHECK (role IN ('admin', 'editor', 'viewer')),
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- CLIENTS (1 client = 1 commerce)
-- ============================================================
CREATE TABLE IF NOT EXISTS clients (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  business_name TEXT NOT NULL,
  contact_name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  city TEXT,
  category TEXT,
  status TEXT NOT NULL DEFAULT 'onboarding' CHECK (status IN (
    'onboarding', 'script_writing', 'script_review', 'script_validated',
    'filming_scheduled', 'filming_done', 'editing', 'published'
  )),
  ghl_contact_id TEXT,
  portal_token TEXT UNIQUE,
  notes TEXT,
  filming_date DATE,
  publication_deadline DATE,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_clients_status ON clients(status);
CREATE INDEX IF NOT EXISTS idx_clients_portal_token ON clients(portal_token);

-- ============================================================
-- SCRIPTS (1 per client, Tiptap JSON content)
-- ============================================================
CREATE TABLE IF NOT EXISTS scripts (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  title TEXT NOT NULL DEFAULT 'Script vidéo',
  content JSONB,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN (
    'draft', 'proposition', 'awaiting_changes', 'modified', 'confirmed'
  )),
  version INT NOT NULL DEFAULT 1,
  created_by UUID REFERENCES saas_users(id),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(client_id)
);

CREATE INDEX IF NOT EXISTS idx_scripts_client ON scripts(client_id);

-- ============================================================
-- SCRIPT COMMENTS
-- ============================================================
CREATE TABLE IF NOT EXISTS script_comments (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  script_id UUID NOT NULL REFERENCES scripts(id) ON DELETE CASCADE,
  author_name TEXT NOT NULL,
  author_type TEXT NOT NULL CHECK (author_type IN ('admin', 'client')),
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_comments_script ON script_comments(script_id);

-- ============================================================
-- SCRIPT VERSIONS (history)
-- ============================================================
CREATE TABLE IF NOT EXISTS script_versions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  script_id UUID NOT NULL REFERENCES scripts(id) ON DELETE CASCADE,
  version INT NOT NULL,
  content JSONB,
  status TEXT NOT NULL,
  created_by UUID REFERENCES saas_users(id),
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_versions_script ON script_versions(script_id);

-- ============================================================
-- FILMING SLOTS (calendar, 1 slot per day Mon-Fri, 3h each)
-- ============================================================
CREATE TABLE IF NOT EXISTS filming_slots (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  date DATE UNIQUE NOT NULL,
  client_id UUID REFERENCES clients(id) ON DELETE SET NULL,
  start_time TIME NOT NULL DEFAULT '09:00',
  duration_hours INT NOT NULL DEFAULT 3,
  status TEXT NOT NULL DEFAULT 'available' CHECK (status IN ('available', 'booked', 'completed', 'cancelled')),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_filming_date ON filming_slots(date);

-- ============================================================
-- RLS policies (permissive for service key, restrict for anon)
-- ============================================================
ALTER TABLE saas_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE scripts ENABLE ROW LEVEL SECURITY;
ALTER TABLE script_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE script_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE filming_slots ENABLE ROW LEVEL SECURITY;

-- Service role can do everything
CREATE POLICY "service_all" ON saas_users FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "service_all" ON clients FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "service_all" ON scripts FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "service_all" ON script_comments FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "service_all" ON script_versions FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "service_all" ON filming_slots FOR ALL USING (true) WITH CHECK (true);
