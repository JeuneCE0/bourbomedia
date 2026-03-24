const { verifyToken } = require('./auth');
const crypto = require('crypto');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

function getToken(req) {
  const auth = req.headers.authorization;
  return auth && auth.startsWith('Bearer ') ? auth.slice(7) : null;
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (!verifyToken(getToken(req))) {
    return res.status(401).json({ error: 'Non autorisé' });
  }

  const action = req.query.action;

  /* ── GET logs ── */
  if (req.method === 'GET' && action === 'logs') {
    try {
      const r = await fetch(`${SUPABASE_URL}/rest/v1/admin_logs?select=*&order=created_at.desc&limit=50`, {
        headers: { 'apikey': SUPABASE_ANON_KEY, 'Authorization': `Bearer ${SUPABASE_ANON_KEY}` }
      });
      const data = await r.json();
      return res.status(200).json(data);
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  /* ── POST log entry ── */
  if (req.method === 'POST' && action === 'log') {
    try {
      const { logAction, project_id, project_name, details } = req.body;
      await fetch(`${SUPABASE_URL}/rest/v1/admin_logs`, {
        method: 'POST',
        headers: {
          'apikey': SUPABASE_SERVICE_KEY,
          'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ action: logAction, project_id, project_name, details })
      });
      return res.status(200).json({ success: true });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  /* ── POST change password ── */
  if (req.method === 'POST' && action === 'password') {
    const { current, newPassword } = req.body || {};
    if (!current || !newPassword) return res.status(400).json({ error: 'Champs requis' });
    if (current !== process.env.ADMIN_PASSWORD) return res.status(401).json({ error: 'Mot de passe actuel incorrect' });
    if (newPassword.length < 6) return res.status(400).json({ error: 'Minimum 6 caractères' });
    // Note: Vercel env vars can't be changed at runtime.
    // This returns a message to update manually.
    return res.status(200).json({
      success: false,
      message: 'Pour changer le mot de passe, mettez à jour la variable ADMIN_PASSWORD dans Vercel Dashboard > Settings > Environment Variables, puis redéployez.'
    });
  }

  /* ── POST bulk action ── */
  if (req.method === 'POST' && action === 'bulk') {
    const { ids, operation, value } = req.body || {};
    if (!ids || !ids.length || !operation) return res.status(400).json({ error: 'ids et operation requis' });

    try {
      if (operation === 'delete') {
        const idFilter = ids.map(id => `"${id}"`).join(',');
        const r = await fetch(`${SUPABASE_URL}/rest/v1/projects?id=in.(${idFilter})`, {
          method: 'DELETE',
          headers: { 'apikey': SUPABASE_SERVICE_KEY, 'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}` }
        });
        if (!r.ok) return res.status(r.status).json({ error: await r.text() });
      } else if (operation === 'status') {
        const idFilter = ids.map(id => `"${id}"`).join(',');
        const r = await fetch(`${SUPABASE_URL}/rest/v1/projects?id=in.(${idFilter})`, {
          method: 'PATCH',
          headers: {
            'apikey': SUPABASE_SERVICE_KEY,
            'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
            'Content-Type': 'application/json',
            'Prefer': 'return=minimal'
          },
          body: JSON.stringify({ status: value || 'published' })
        });
        if (!r.ok) return res.status(r.status).json({ error: await r.text() });
      } else if (operation === 'reorder') {
        // value = [{id, display_order}, ...]
        for (const item of (value || [])) {
          await fetch(`${SUPABASE_URL}/rest/v1/projects?id=eq.${item.id}`, {
            method: 'PATCH',
            headers: {
              'apikey': SUPABASE_SERVICE_KEY,
              'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
              'Content-Type': 'application/json',
              'Prefer': 'return=minimal'
            },
            body: JSON.stringify({ display_order: item.display_order })
          });
        }
      }
      return res.status(200).json({ success: true });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  /* ── GET settings ── */
  if (req.method === 'GET' && action === 'settings') {
    try {
      const r = await fetch(`${SUPABASE_URL}/rest/v1/site_settings?select=key,value`, {
        headers: { 'apikey': SUPABASE_ANON_KEY, 'Authorization': `Bearer ${SUPABASE_ANON_KEY}` }
      });
      const data = await r.json();
      return res.status(200).json(data);
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  /* ── POST settings ── */
  if (req.method === 'POST' && action === 'settings') {
    try {
      const { settings } = req.body || {};
      if (!settings || !Array.isArray(settings)) return res.status(400).json({ error: 'settings array requis' });
      for (const s of settings) {
        await fetch(`${SUPABASE_URL}/rest/v1/site_settings?key=eq.${s.key}`, {
          method: 'PATCH',
          headers: {
            'apikey': SUPABASE_SERVICE_KEY,
            'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
            'Content-Type': 'application/json',
            'Prefer': 'return=minimal'
          },
          body: JSON.stringify({ value: String(s.value), updated_at: new Date().toISOString() })
        });
      }
      return res.status(200).json({ success: true });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  return res.status(400).json({ error: 'Action inconnue' });
};
