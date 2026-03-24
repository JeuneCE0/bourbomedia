const crypto = require('crypto');
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { id, vid } = req.body || {};
  if (!id) return res.status(400).json({ error: 'ID requis' });

  // Generate visitor fingerprint from IP + User-Agent if no vid provided
  const ip = req.headers['x-forwarded-for'] || req.headers['x-real-ip'] || 'unknown';
  const ua = req.headers['user-agent'] || 'unknown';
  const visitorId = vid || crypto.createHash('sha256').update(ip + ua).digest('hex').slice(0, 16);

  try {
    // Increment counter
    await fetch(`${SUPABASE_URL}/rest/v1/rpc/increment_click`, {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_SERVICE_KEY,
        'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ project_id: id })
    });

    // Update the last click with visitor_id
    await fetch(`${SUPABASE_URL}/rest/v1/project_clicks?order=created_at.desc&limit=1&project_id=eq.${id}`, {
      method: 'PATCH',
      headers: {
        'apikey': SUPABASE_SERVICE_KEY,
        'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal'
      },
      body: JSON.stringify({ visitor_id: visitorId })
    });

    return res.status(200).json({ success: true });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};
