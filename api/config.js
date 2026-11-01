// Vercel Serverless Function: Public Configuration Endpoint
// Exposes only non-sensitive public environment variables to the frontend.

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=600');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const supabaseUrl = process.env.SUPABASE_URL || 'https://ohqlojvwczzealcnmbcs.supabase.co';
  const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || 'sb_publishable_IqpW1FGzJML7je2Oy91iYg_chGTSJn5';

  return res.status(200).json({
    supabaseUrl,
    supabaseAnonKey
  });
};
