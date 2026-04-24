-- Legacy tables used by admin panel and landing page showcase
-- Safe to run on existing DB: uses IF NOT EXISTS

-- ============================================================
-- PROJECTS (landing page showcase / past work)
-- ============================================================
CREATE TABLE IF NOT EXISTS projects (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  category TEXT,
  client_name TEXT,
  video_url TEXT,
  thumbnail_url TEXT,
  photos JSONB DEFAULT '[]'::jsonb,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived')),
  display_order INT DEFAULT 0,
  featured BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_projects_status ON projects(status);
CREATE INDEX IF NOT EXISTS idx_projects_order ON projects(display_order);

-- ============================================================
-- ADMIN LOGS (audit trail for admin actions)
-- ============================================================
CREATE TABLE IF NOT EXISTS admin_logs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  action TEXT NOT NULL,
  project_id UUID,
  project_name TEXT,
  details JSONB,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_admin_logs_created ON admin_logs(created_at DESC);

-- ============================================================
-- SITE SETTINGS (key/value config editable from admin panel)
-- ============================================================
CREATE TABLE IF NOT EXISTS site_settings (
  key TEXT PRIMARY KEY,
  value TEXT,
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- RLS policies
-- ============================================================
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE site_settings ENABLE ROW LEVEL SECURITY;

-- Service role: full access. Anon: read published projects + read settings.
CREATE POLICY "service_all" ON projects FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "service_all" ON admin_logs FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "service_all" ON site_settings FOR ALL USING (true) WITH CHECK (true);
