const { verifyToken } = require('./auth');
const crypto = require('crypto');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const BUCKET = 'project-photos';

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const auth = req.headers.authorization;
  const token = auth && auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!verifyToken(token)) {
    return res.status(401).json({ error: 'Non autorisé' });
  }

  try {
    const { file, filename, contentType } = req.body || {};
    if (!file) return res.status(400).json({ error: 'Fichier requis (base64)' });

    const buffer = Buffer.from(file, 'base64');
    const ext = filename ? filename.split('.').pop() : 'jpg';
    const uniqueName = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}.${ext}`;

    const uploadRes = await fetch(
      `${SUPABASE_URL}/storage/v1/object/${BUCKET}/${uniqueName}`,
      {
        method: 'POST',
        headers: {
          'apikey': SUPABASE_SERVICE_KEY,
          'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
          'Content-Type': contentType || 'image/jpeg',
          'x-upsert': 'true'
        },
        body: buffer
      }
    );

    if (!uploadRes.ok) {
      const err = await uploadRes.text();
      console.error('Supabase Storage error:', uploadRes.status, err);
      return res.status(uploadRes.status).json({ error: err });
    }

    const publicUrl = `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${uniqueName}`;
    return res.status(200).json({ url: publicUrl, name: uniqueName });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};
