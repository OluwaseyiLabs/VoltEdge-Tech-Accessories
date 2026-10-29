// Vercel Serverless Function: Secure Order Details Lookup Proxy
// Enforces 20 requests / 1 minute rate limit on status queries.

const { rateLimitMiddleware } = require('./_rate-limiter');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // 1. Enforce Server-Side Rate Limit (20 requests / 1 minute)
  const allowed = await rateLimitMiddleware(req, res, 'order_lookup');
  if (!allowed) {
    return; // 429 response already sent with Retry-After header
  }

  const queryParams = new URLSearchParams(req.query || {}).toString();
  const baseWebhookUrl = process.env.VOLTEDGE_ORDER_DETAILS_WEBHOOK_URL || 'https://ucy00zep.rpcld.net/webhook/voltedge-order-details';
  const targetUrl = queryParams ? `${baseWebhookUrl}?${queryParams}` : baseWebhookUrl;
  const apiKey = process.env.VOLTEDGE_API_KEY || process.env.N8N_API_KEY || '';

  try {
    const headers = {
      'Accept': 'application/json',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    };
    if (apiKey) {
      headers['X-N8N-API-KEY'] = apiKey;
      headers['Authorization'] = `Bearer ${apiKey}`;
    }

    const response = await fetch(targetUrl, {
      method: 'GET',
      headers
    });

    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      const data = await response.json();
      return res.status(response.status).json(data);
    } else {
      const text = await response.text();
      return res.status(response.status).send(text);
    }
  } catch (err) {
    console.error('[VoltEdge API Proxy Error - Order Details]:', err);
    return res.status(502).json({
      success: false,
      message: 'Order lookup service temporarily unavailable.'
    });
  }
};
