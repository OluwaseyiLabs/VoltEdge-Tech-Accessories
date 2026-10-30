// Vercel Serverless Function: Secure Order Submission Proxy
// Enforces 5 requests / 1 minute rate limit, order idempotency protection,
// and authoritative backend order persistence for cross-device retrieval.

const { rateLimitMiddleware, checkOrderDuplicate, recordOrderResponse, clearIdempotency } = require('./_rate-limiter');
const { saveOrder, updateOrderStatus } = require('./_order-store');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, message: 'Method Not Allowed' });
  }

  // 1. Enforce Server-Side Rate Limit (5 requests / 1 minute)
  const allowed = await rateLimitMiddleware(req, res, 'order_submission');
  if (!allowed) {
    return; // 429 response already sent with Retry-After header
  }

  // 2. Parse body & check order submission idempotency
  let bodyObj = {};
  try {
    bodyObj = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
  } catch {
    bodyObj = {};
  }
  const orderId = bodyObj.orderId || bodyObj.order_id || bodyObj.trackingCode;

  // Protect against duplicate order creation / duplicate emails
  if (orderId) {
    const dupCheck = checkOrderDuplicate(orderId, bodyObj);
    if (dupCheck.isDuplicate) {
      if (dupCheck.cachedResponse) {
        console.log(`[VoltEdge API] Idempotent cache hit for duplicate order ${orderId}`);
        return res.status(200).json(dupCheck.cachedResponse);
      }
      if (dupCheck.inFlight) {
        console.warn(`[VoltEdge API] Duplicate in-flight submission ignored for order ${orderId}`);
        return res.status(409).json({
          success: false,
          error: 'Conflict',
          message: 'This order is currently being processed. Please do not submit again.'
        });
      }
    }
  }

  // 3. Ensure lookup token is established and persist order immediately to authoritative store
  if (orderId) {
    if (!bodyObj.token && !bodyObj.lookup_token && !bodyObj.lookupToken) {
      bodyObj.token = 've_tok_' + Math.random().toString(36).substring(2, 10);
      bodyObj.lookup_token = bodyObj.token;
    }
    try {
      await saveOrder(bodyObj);
    } catch (saveErr) {
      console.warn('[VoltEdge Order API] Failed to persist initial order to backend store:', saveErr.message);
    }
  }

  const targetWebhookUrl = process.env.VOLTEDGE_ORDER_WEBHOOK_URL || 'https://ucy00zep.rpcld.net/webhook/voltedge-order';
  const apiKey = process.env.VOLTEDGE_API_KEY || process.env.N8N_API_KEY || '';

  try {
    const headers = {
      'Content-Type': 'application/json',
      'Accept': 'application/json, text/plain, */*',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    };
    if (apiKey) {
      headers['X-N8N-API-KEY'] = apiKey;
      headers['Authorization'] = `Bearer ${apiKey}`;
    }

    const payload = JSON.stringify(bodyObj);
    const response = await fetch(targetWebhookUrl, {
      method: 'POST',
      headers,
      body: payload
    });

    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      const data = await response.json();
      if (response.ok && orderId) {
        recordOrderResponse(orderId, data);
        // If webhook returned payment_link or updated status, persist it in authoritative store
        if (data && typeof data === 'object') {
          const paymentLink = data.payment_link || data.paymentLink || data.checkout_url || data.url || '';
          if (paymentLink) {
            await updateOrderStatus(orderId, { payment_link: paymentLink });
          }
        }
      } else if (!response.ok && orderId) {
        clearIdempotency(orderId);
      }
      return res.status(response.status).json(data);
    } else {
      const text = await response.text();
      if (!response.ok && orderId) {
        clearIdempotency(orderId);
      }
      return res.status(response.status).send(text);
    }
  } catch (err) {
    if (orderId) clearIdempotency(orderId);
    console.error('[VoltEdge API Proxy Error - Order Submission]:', err);
    return res.status(502).json({
      success: false,
      message: 'Fulfillment gateway error. Please try again or contact WhatsApp support.'
    });
  }
};
