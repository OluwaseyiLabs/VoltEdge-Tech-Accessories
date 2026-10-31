// Vercel Serverless Function: Secure Order Submission Proxy
// Enforces 5 requests / 1 minute rate limit, order idempotency protection,
// and authoritative backend order persistence for cross-device retrieval.

const { rateLimitMiddleware, checkOrderDuplicate, recordOrderResponse, clearIdempotency } = require('./_rate-limiter');
const { saveOrder, updateOrderStatus } = require('./_order-store');

// Input Sanitization Utilities
function sanitizeStr(val, maxLen = 255) {
  if (typeof val !== 'string') return '';
  return val
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
    .replace(/<[^>]*>?/gm, '')
    .replace(/javascript:/gi, '')
    .replace(/\bon\w+\s*=/gi, '')
    .trim()
    .slice(0, maxLen);
}

function sanitizeEmail(val) {
  if (typeof val !== 'string') return '';
  return val
    .replace(/<[^>]*>?/gm, '')
    .replace(/[\s"'\\]/g, '')
    .trim()
    .slice(0, 120);
}

function sanitizePhone(val) {
  if (typeof val !== 'string') return '';
  return val
    .replace(/[^0-9+\s-]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 25);
}

const FRIENDLY_ERROR_MSG = 'An error occurred, please try again later or contact us on WhatsApp.';

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

  // Server-side input sanitization
  if (bodyObj && typeof bodyObj === 'object') {
    if (bodyObj.customer_name) bodyObj.customer_name = sanitizeStr(bodyObj.customer_name, 100);
    if (bodyObj.customer_email) bodyObj.customer_email = sanitizeEmail(bodyObj.customer_email);
    if (bodyObj.customer_phone) bodyObj.customer_phone = sanitizePhone(bodyObj.customer_phone);
    if (bodyObj.delivery_address) bodyObj.delivery_address = sanitizeStr(bodyObj.delivery_address, 255);
    if (bodyObj.delivery_state) bodyObj.delivery_state = sanitizeStr(bodyObj.delivery_state, 60);
    if (bodyObj.delivery_notes) bodyObj.delivery_notes = sanitizeStr(bodyObj.delivery_notes, 500);
    if (bodyObj.customer && typeof bodyObj.customer === 'object') {
      const cObj = bodyObj.customer;
      if (cObj.name) cObj.name = sanitizeStr(cObj.name, 100);
      if (cObj.fullName) cObj.fullName = sanitizeStr(cObj.fullName, 100);
      if (cObj.email) cObj.email = sanitizeEmail(cObj.email);
      if (cObj.phone) cObj.phone = sanitizePhone(cObj.phone);
      if (cObj.fullPhone) cObj.fullPhone = sanitizePhone(cObj.fullPhone);
      if (cObj.address) cObj.address = sanitizeStr(cObj.address, 255);
      if (cObj.state) cObj.state = sanitizeStr(cObj.state, 60);
      if (cObj.notes) cObj.notes = sanitizeStr(cObj.notes, 500);
    }
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

    // Ensure products_json is stringified for Google Sheets compatibility
    if (Array.isArray(bodyObj.products) && bodyObj.products.length > 0) {
      bodyObj.products_json = JSON.stringify(bodyObj.products);
      if (!bodyObj.quantity || bodyObj.quantity === 1) {
        bodyObj.quantity = bodyObj.products.reduce((sum, p) => sum + (Number(p.quantity) || 1), 0);
      }
      if (bodyObj.products.length > 1) {
        bodyObj.product_sku = 'MULTIPLE';
        bodyObj.product_SKU = 'MULTIPLE';
        if (!bodyObj.product_name) {
          bodyObj.product_name = bodyObj.products.map(p => `${p.product_name} x${p.quantity}`).join('; ');
        }
      }
    }

    try {
      const saved = await saveOrder(bodyObj);
      if (saved) {
        bodyObj.products = saved.products;
        bodyObj.products_json = saved.products_json;
      }
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
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60000); // Always wait up to 60s for webhook
    const response = await fetch(targetWebhookUrl, {
      method: 'POST',
      headers,
      body: payload,
      signal: controller.signal
    });
    clearTimeout(timeout);

    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      const data = await response.json();
      const msgStr = String((data && (data.message || data.error)) || '').toLowerCase();
      const isWorkflowError = msgStr.includes('workflow') || msgStr.includes('error in');

      if (!response.ok || isWorkflowError) {
        if (orderId) clearIdempotency(orderId);
        return res.status(response.ok ? 502 : response.status).json({
          success: false,
          error: 'OrderProcessingError',
          message: FRIENDLY_ERROR_MSG
        });
      }

      if (response.ok && orderId) {
        recordOrderResponse(orderId, data);
        // If webhook returned payment_link or updated status, persist it in authoritative store
        if (data && typeof data === 'object') {
          const paymentLink = data.payment_link || data.paymentLink || data.checkout_url || data.url || '';
          if (paymentLink) {
            await updateOrderStatus(orderId, { payment_link: paymentLink });
          }
        }
      }
      return res.status(200).json(data);
    } else {
      const text = await response.text();
      const textLower = text.toLowerCase();
      const isTextWorkflowError =
        textLower.includes('workflow') ||
        textLower.includes('error in') ||
        textLower.includes('n8n') ||
        textLower.includes('internal error') ||
        textLower.includes('server error');

      if (!response.ok || isTextWorkflowError) {
        if (orderId) clearIdempotency(orderId);
        return res.status(isTextWorkflowError && response.ok ? 502 : response.status).json({
          success: false,
          error: 'OrderProcessingError',
          message: FRIENDLY_ERROR_MSG
        });
      }
      return res.status(response.status).send(text);
    }
  } catch (err) {
    if (orderId) clearIdempotency(orderId);
    console.error('[VoltEdge API Proxy Error - Order Submission]:', err);
    return res.status(502).json({
      success: false,
      error: 'OrderProcessingError',
      message: FRIENDLY_ERROR_MSG
    });
  }
};
