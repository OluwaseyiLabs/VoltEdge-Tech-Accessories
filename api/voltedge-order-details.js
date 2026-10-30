// Vercel Serverless Function: Secure Order Details Lookup Proxy
// Enforces 20 requests / 1 minute rate limit on status queries,
// token-verified authoritative order retrieval, and isolation against cross-customer contamination.

const { rateLimitMiddleware } = require('./_rate-limiter');
const { getOrder, saveOrder } = require('./_order-store');

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

  // 2. Validate required orderId parameter
  const query = req.query || {};
  const orderId = String(query.orderId || query.order_id || query.reference || query.trackingCode || '').trim();
  const token = String(query.token || query.lookup_token || query.lookupToken || query.t || '').trim();

  if (!orderId) {
    return res.status(400).json({
      success: false,
      error: 'BadRequest',
      message: 'orderId parameter is required.'
    });
  }

  // Reject contaminated test mock ID
  if (orderId.toLowerCase() === 've-20261029-5826') {
    return res.status(404).json({
      success: false,
      error: 'NotFound',
      message: 'Order reference not found.'
    });
  }

  // 3. First, try live n8n webhook (with strict ID matching to prevent mock bleed)
  const queryParams = new URLSearchParams(query).toString();
  const baseWebhookUrl = process.env.VOLTEDGE_ORDER_DETAILS_WEBHOOK_URL || 'https://ucy00zep.rpcld.net/webhook/voltedge-order-details';
  const targetUrl = queryParams ? `${baseWebhookUrl}?${queryParams}` : baseWebhookUrl;
  const apiKey = process.env.VOLTEDGE_API_KEY || process.env.N8N_API_KEY || '';

  let n8nSuccess = false;
  let n8nOrder = null;

  try {
    const headers = {
      'Accept': 'application/json',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    };
    if (apiKey) {
      headers['X-N8N-API-KEY'] = apiKey;
      headers['Authorization'] = `Bearer ${apiKey}`;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4000);

    const response = await fetch(targetUrl, {
      method: 'GET',
      headers,
      signal: controller.signal
    });
    clearTimeout(timeout);

    if (response.ok) {
      const contentType = response.headers.get('content-type') || '';
      if (contentType.includes('application/json')) {
        const data = await response.json();
        const extracted = (data && data.order) ? data.order : (data && data.data ? data.data : data);
        if (extracted && typeof extracted === 'object') {
          const returnedId = String(extracted.order_id || extracted.orderId || extracted.trackingCode || '').trim();
          // STRICT MATCH: Only accept if the returned order ID matches the requested order ID
          if (returnedId && returnedId.toLowerCase() === orderId.toLowerCase() && returnedId.toLowerCase() !== 've-20261029-5826') {
            n8nSuccess = true;
            n8nOrder = extracted;
            // Update authoritative backend store
            await saveOrder({ ...extracted, order_id: returnedId, token: token || extracted.token });
          }
        }
      }
    }
  } catch (err) {
    // n8n request failed or timed out — fall back to authoritative store
    console.warn(`[VoltEdge Order Details] n8n lookup bypassed/failed for ${orderId}:`, err.message);
  }

  // If n8n gave a valid exact match, verify token and return
  if (n8nSuccess && n8nOrder) {
    const localCheck = await getOrder(orderId, token);
    if (localCheck.success) {
      return res.status(200).json({
        success: true,
        order: localCheck.order
      });
    } else if (localCheck.status === 403) {
      return res.status(403).json(localCheck);
    }
  }

  // 4. Fall back to authoritative backend order store
  const storeResult = await getOrder(orderId, token);
  return res.status(storeResult.status || (storeResult.success ? 200 : 404)).json(storeResult);
};
