const { verifyToken } = require('./auth');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

function getToken(req) {
  const auth = req.headers.authorization;
  return auth && auth.startsWith('Bearer ') ? auth.slice(7) : null;
}

function supaFetch(path, options = {}, useServiceKey = false) {
  const key = useServiceKey ? SUPABASE_SERVICE_KEY : SUPABASE_ANON_KEY;
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...options,
    headers: {
      'apikey': key,
      'Authorization': `Bearer ${key}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=representation',
      ...(options.headers || {})
    }
  });
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  /* ── GET: public read ── */
  if (req.method === 'GET') {
    try {
      const r = await supaFetch('projects?select=*&order=created_at.desc');
      if (!r.ok) {
        const err = await r.text();
        return res.status(r.status).json({ error: err });
      }
      const data = await r.json();
      return res.status(200).json(data);
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  /* ── Auth required for write ops ── */
  if (!verifyToken(getToken(req))) {
    return res.status(401).json({ error: 'Non autorisé' });
  }

  /* ── POST: create ── */
  if (req.method === 'POST') {
    try {
      const body = req.body;
      const r = await supaFetch('projects', {
        method: 'POST',
        body: JSON.stringify(body)
      }, true);
      if (!r.ok) {
        const err = await r.text();
        return res.status(r.status).json({ error: err });
      }
      const data = await r.json();
      return res.status(201).json(data[0]);
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  /* ── PUT: update ── */
  if (req.method === 'PUT') {
    try {
      const { id, ...fields } = req.body;
      if (!id) return res.status(400).json({ error: 'ID requis' });
      fields.updated_at = new Date().toISOString();
      const r = await supaFetch(`projects?id=eq.${id}`, {
        method: 'PATCH',
        body: JSON.stringify(fields)
      }, true);
      if (!r.ok) {
        const err = await r.text();
        return res.status(r.status).json({ error: err });
      }
      const data = await r.json();
      return res.status(200).json(data[0]);
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  /* ── DELETE ── */
  if (req.method === 'DELETE') {
    try {
      const { id } = req.body || {};
      if (!id) return res.status(400).json({ error: 'ID requis' });
      const r = await supaFetch(`projects?id=eq.${id}`, {
        method: 'DELETE'
      }, true);
      if (!r.ok) {
        const err = await r.text();
        return res.status(r.status).json({ error: err });
      }
      return res.status(200).json({ success: true });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
};
