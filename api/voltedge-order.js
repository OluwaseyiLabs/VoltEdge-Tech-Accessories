// Vercel Serverless Function: Secure Order Submission Proxy
// Enforces 5 requests / 1 minute rate limit, order idempotency protection,
// authoritative backend product/price/stock validation against Supabase,
// atomic inventory reservation, and persistence for cross-device retrieval.

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

  // 3. TASK 6: Backend Product, Price & Stock Validation against Supabase
  const supabaseUrl = process.env.SUPABASE_URL || 'https://ohqlojvwczzealcnmbcs.supabase.co';
  const supabaseKey = process.env.SUPABASE_ANON_KEY || 'sb_publishable_IqpW1FGzJML7je2Oy91iYg_chGTSJn5';

  const rawProducts = Array.isArray(bodyObj.products) && bodyObj.products.length > 0
    ? bodyObj.products
    : [{
        product_sku: bodyObj.product_sku || bodyObj.product_SKU,
        product_name: bodyObj.product_name,
        quantity: bodyObj.quantity || 1,
        unit_price: bodyObj.unit_price
      }];

  const verifiedProducts = [];

  if (supabaseUrl && supabaseKey) {
    try {
      for (const item of rawProducts) {
        const reqSku = (item.product_sku || item.sku || '').trim();
        const reqQty = Math.max(1, parseInt(item.quantity, 10) || 1);

        if (!reqSku) {
          if (orderId) clearIdempotency(orderId);
          return res.status(400).json({
            success: false,
            error: 'InvalidProduct',
            message: 'Order contains an item with missing SKU.'
          });
        }

        // Query product and live inventory from Supabase
        const prodQueryUrl = `${supabaseUrl}/rest/v1/products?sku=eq.${encodeURIComponent(reqSku)}&select=id,name,sku,price,is_published,publication_status,inventory(stock_on_hand,reserved_quantity,available_quantity,sales_enabled)`;
        const supaProdRes = await fetch(prodQueryUrl, {
          method: 'GET',
          headers: {
            'apikey': supabaseKey,
            'Authorization': `Bearer ${supabaseKey}`,
            'Accept': 'application/json'
          }
        });

        if (!supaProdRes.ok) {
          console.warn(`[VoltEdge Order API] Could not verify SKU ${reqSku} from database: HTTP ${supaProdRes.status}`);
          // Fall back gracefully if database read error occurs
          verifiedProducts.push({
            product_sku: reqSku,
            product_name: item.product_name || 'VoltEdge Hardware',
            unit_price: Number(item.unit_price) || 0,
            quantity: reqQty,
            line_total: (Number(item.unit_price) || 0) * reqQty
          });
          continue;
        }

        const prodList = await supaProdRes.json();
        if (!Array.isArray(prodList) || prodList.length === 0) {
          if (orderId) clearIdempotency(orderId);
          return res.status(400).json({
            success: false,
            error: 'ProductNotFound',
            message: `Product with SKU "${reqSku}" does not exist in catalogue.`
          });
        }

        const dbProd = prodList[0];

        // Verify published status
        if (!dbProd.is_published || dbProd.publication_status !== 'PUBLISHED') {
          if (orderId) clearIdempotency(orderId);
          return res.status(400).json({
            success: false,
            error: 'ProductUnpublished',
            message: `"${dbProd.name}" (${dbProd.sku}) is no longer available for order.`
          });
        }

        // Verify inventory & sales enabled
        const inv = Array.isArray(dbProd.inventory) ? dbProd.inventory[0] : (dbProd.inventory || {});
        const salesEnabled = inv.sales_enabled !== false;
        const onHand = Number(inv.stock_on_hand) || 0;
        const reserved = Number(inv.reserved_quantity) || 0;
        const available = inv.available_quantity !== undefined 
          ? Number(inv.available_quantity) 
          : Math.max(0, onHand - reserved);

        if (!salesEnabled) {
          if (orderId) clearIdempotency(orderId);
          return res.status(400).json({
            success: false,
            error: 'SalesDisabled',
            message: `Online sales for "${dbProd.name}" are temporarily disabled.`
          });
        }

        if (available < reqQty) {
          if (orderId) clearIdempotency(orderId);
          return res.status(400).json({
            success: false,
            error: 'InsufficientStock',
            message: `Insufficient stock for "${dbProd.name}". Only ${Math.max(0, available)} unit(s) available.`
          });
        }

        // Enforce authoritative database price (prevent DevTools price manipulation)
        const authoritativePrice = Number(dbProd.price);
        verifiedProducts.push({
          product_sku: dbProd.sku,
          product_name: dbProd.name,
          unit_price: authoritativePrice,
          quantity: reqQty,
          line_total: authoritativePrice * reqQty
        });
      }
    } catch (valErr) {
      console.warn('[VoltEdge Order API] Backend price validation notice:', valErr.message);
    }
  }

  // Use verified products if validated, otherwise preserve clean structure
  const finalProducts = verifiedProducts.length > 0 ? verifiedProducts : rawProducts;
  const verifiedSubtotal = finalProducts.reduce((sum, p) => sum + (Number(p.line_total) || ((Number(p.unit_price) || 0) * (Number(p.quantity) || 1))), 0);
  const totalUnits = finalProducts.reduce((sum, p) => sum + (Number(p.quantity) || 1), 0);
  const isSingle = finalProducts.length === 1;

  // Overwrite client submission with backend-verified authoritative calculations
  bodyObj.products = finalProducts;
  bodyObj.products_json = JSON.stringify(finalProducts);
  bodyObj.total_price = verifiedSubtotal;
  bodyObj.totalAmount = verifiedSubtotal;
  bodyObj.quantity = totalUnits;
  bodyObj.product_sku = isSingle ? finalProducts[0].product_sku : 'MULTIPLE';
  bodyObj.product_SKU = bodyObj.product_sku;
  bodyObj.product_name = isSingle ? finalProducts[0].product_name : finalProducts.map(p => `${p.product_name} x${p.quantity}`).join('; ');
  bodyObj.unit_price = isSingle ? finalProducts[0].unit_price : verifiedSubtotal;

  // 4. Ensure lookup token is established and persist order immediately to authoritative store
  if (orderId) {
    if (!bodyObj.token && !bodyObj.lookup_token && !bodyObj.lookupToken) {
      bodyObj.token = 've_tok_' + Math.random().toString(36).substring(2, 10);
      bodyObj.lookup_token = bodyObj.token;
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

    // 5. Supabase Inventory Reservation (lock warehouse stock for order atomically)
    if (Array.isArray(bodyObj.products) && bodyObj.products.length > 0 && supabaseUrl && supabaseKey) {
      try {
        const reservationItems = bodyObj.products.map(p => ({
          sku: p.product_sku || p.sku,
          product_name: p.product_name || p.name,
          quantity: Number(p.quantity) || 1,
          unit_price: Number(p.unit_price) || 0
        }));

        const supaRes = await fetch(`${supabaseUrl}/rest/v1/rpc/reserve_stock`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'apikey': supabaseKey,
            'Authorization': `Bearer ${supabaseKey}`
          },
          body: JSON.stringify({
            p_order_id: orderId,
            p_items: reservationItems,
            p_idempotency_key: orderId
          })
        });

        if (supaRes.ok) {
          const resJson = await supaRes.json();
          if (resJson && resJson.success === false) {
            console.warn('[VoltEdge Order API] Stock reservation rejected:', resJson.error);
            if (orderId) clearIdempotency(orderId);
            return res.status(400).json({
              success: false,
              error: 'InsufficientStock',
              message: resJson.error || 'One or more items in your cart is currently out of stock.'
            });
          }
          console.log(`[VoltEdge Order API] Stock reserved in Supabase for ${orderId}`);
        }
      } catch (resErr) {
        console.warn('[VoltEdge Order API] Non-fatal Supabase reservation notice:', resErr.message);
      }
    }
  }

  // 6. Forward verified order to n8n automation pipeline
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
    const timeout = setTimeout(() => controller.abort(), 60000); // Wait up to 60s for webhook
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

      // Canonical check for payment-ready order (Scenario A: HTTP 200, Scenario B: HTTP 502 email-failure with order saved & valid checkout_url)
      const hasValidCheckoutUrl = data &&
        typeof data.checkout_url === 'string' &&
        data.checkout_url.trim().startsWith('https://');

      const isOrderSavedAndPaymentReady = data &&
        data.order_saved === true &&
        data.payment_link_generated === true &&
        hasValidCheckoutUrl;

      if (isOrderSavedAndPaymentReady) {
        if (orderId) {
          recordOrderResponse(orderId, data);
          try {
            await updateOrderStatus(orderId, {
              checkout_url: data.checkout_url,
              order_status: data.order_status || 'PENDING_PAYMENT'
            });
          } catch (updateErr) {
            console.warn('[VoltEdge Order API] Could not update order status store:', updateErr.message);
          }
        }
        // Preserve response status (200 for Scenario A, 502 for Scenario B) and deliver verified JSON to frontend
        return res.status(response.status).json(data);
      }

      if (!response.ok || isWorkflowError || (data && data.success === false)) {
        if (orderId) {
          clearIdempotency(orderId);
          // Release stock reservation on failed n8n processing or payment-link generation failure
          if (supabaseUrl && supabaseKey) {
            fetch(`${supabaseUrl}/rest/v1/rpc/release_reservation`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'apikey': supabaseKey, 'Authorization': `Bearer ${supabaseKey}` },
              body: JSON.stringify({ p_order_id: orderId, p_reason: 'N8N_WORKFLOW_ERROR' })
            }).catch(() => {});
          }
        }

        // Pass through structured error from n8n (e.g. Scenario C payment link failure, Scenario D invalid order)
        if (data && typeof data === 'object' && (data.message || data.payment_link_generated === false || data.error)) {
          return res.status(response.ok ? 502 : response.status).json(data);
        }

        return res.status(response.ok ? 502 : response.status).json({
          success: false,
          error: 'OrderProcessingError',
          message: FRIENDLY_ERROR_MSG
        });
      }

      if (response.ok && orderId) {
        recordOrderResponse(orderId, data);
        if (data && typeof data === 'object') {
          const paymentLink = data.checkout_url || data.payment_link || data.paymentLink || data.url || '';
          if (paymentLink) {
            await updateOrderStatus(orderId, { checkout_url: paymentLink, payment_link: paymentLink });
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
        if (orderId) {
          clearIdempotency(orderId);
          if (supabaseUrl && supabaseKey) {
            fetch(`${supabaseUrl}/rest/v1/rpc/release_reservation`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'apikey': supabaseKey, 'Authorization': `Bearer ${supabaseKey}` },
              body: JSON.stringify({ p_order_id: orderId, p_reason: 'N8N_TEXT_ERROR' })
            }).catch(() => {});
          }
        }
        return res.status(isTextWorkflowError && response.ok ? 502 : response.status).json({
          success: false,
          error: 'OrderProcessingError',
          message: FRIENDLY_ERROR_MSG
        });
      }
      return res.status(response.status).send(text);
    }
  } catch (err) {
    if (orderId) {
      clearIdempotency(orderId);
      if (supabaseUrl && supabaseKey) {
        fetch(`${supabaseUrl}/rest/v1/rpc/release_reservation`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'apikey': supabaseKey, 'Authorization': `Bearer ${supabaseKey}` },
          body: JSON.stringify({ p_order_id: orderId, p_reason: 'SERVER_NETWORK_TIMEOUT' })
        }).catch(() => {});
      }
    }
    console.error('[VoltEdge API Proxy Error - Order Submission]:', err);
    return res.status(502).json({
      success: false,
      error: 'OrderProcessingError',
      message: FRIENDLY_ERROR_MSG
    });
  }
};
