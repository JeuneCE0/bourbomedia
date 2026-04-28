-- Tâches indépendantes : permet de créer une task sans la rattacher à un
-- client et sans deadline obligatoire. Le legacy clients.todos (JSONB) reste
-- utilisé pour les tâches déjà liées à un client en lecture, mais l'admin
-- peut maintenant créer des tâches purement personnelles.

CREATE TABLE IF NOT EXISTS tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID REFERENCES clients(id) ON DELETE CASCADE,  -- null = tâche perso
  text TEXT NOT NULL,
  done BOOLEAN DEFAULT FALSE,
  due_date DATE,                                            -- null = pas de deadline
  priority TEXT DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high')),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tasks_client ON tasks(client_id);
CREATE INDEX IF NOT EXISTS idx_tasks_due ON tasks(due_date);
CREATE INDEX IF NOT EXISTS idx_tasks_done ON tasks(done);
