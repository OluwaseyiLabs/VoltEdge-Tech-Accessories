// VoltEdge Authoritative Backend Order Store
// Provides single-source-of-truth order persistence, secure token authentication,
// and cross-device order retrieval independent of browser storage or cookies.

const crypto = require('crypto');

// In-Memory Order Store: Map<normalized_order_id, OrderRecord>
const orderStore = new Map();

/**
 * Normalizes an order payload into the authoritative VoltEdge standard contract.
 */
function normalizeOrderRecord(data) {
  if (!data || typeof data !== 'object') return null;

  const orderId = String(data.order_id || data.orderId || data.trackingCode || '').trim();
  if (!orderId) return null;

  const token = String(data.token || data.lookup_token || data.lookupToken || '').trim();

  // Customer details
  const cust = data.customer || {};
  const customerName = String(
    data.customer_name || data.customerName || data.fullName || cust.fullName || cust.name || ''
  ).trim();

  const customerEmail = String(
    data.customer_email || data.customerEmail || data.email || cust.email || ''
  ).trim();

  const customerPhone = String(
    data.customer_phone || data.customerPhone || data.phone || data.fullPhone || cust.fullPhone || cust.phone || ''
  ).trim();

  const deliveryAddress = String(
    data.delivery_address || data.deliveryAddress || data.address || cust.address || ''
  ).trim();

  const deliveryState = String(
    data.delivery_state || data.deliveryState || data.state || cust.state || cust.deliveryState || ''
  ).trim();

  const deliveryNotes = String(
    data.delivery_notes || data.deliveryNotes || data.orderNotes || data.notes || cust.notes || 'None provided'
  ).trim();

  // Product & pricing details
  const prod = data.product || (data.items && data.items[0]) || {};
  let productName = String(
    data.product_name || data.productName || prod.name || prod.shortName || 'VoltEdge Hardware'
  ).trim();

  let productSku = String(
    data.product_sku || data.productSku || data.sku || prod.sku || prod.id || 'VE-EQUIPMENT'
  ).trim();

  let quantity = Number(data.quantity || data.qty || prod.quantity || 1) || 1;
  let unitPrice = Number(data.unit_price || data.unitPrice || prod.unitPrice || prod.price || 0) || 0;
  let totalPrice = Number(data.total_price || data.totalPrice || data.totalAmount || prod.totalAmount || prod.totalPrice || 0);

  // Multi-product structured list
  let products = [];
  if (Array.isArray(data.products) && data.products.length > 0) {
    products = data.products.map(p => {
      const uPrice = Number(p.unit_price || p.unitPrice || p.price || 0);
      const qty = Number(p.quantity || p.qty || 1);
      const lTotal = Number(p.line_total || p.lineTotal || (uPrice * qty));
      return {
        product_sku: String(p.product_sku || p.productSku || p.sku || 'VE-EQUIPMENT').trim(),
        product_name: String(p.product_name || p.productName || p.name || 'VoltEdge Hardware').trim(),
        unit_price: uPrice,
        quantity: qty,
        line_total: lTotal
      };
    });
  } else if (typeof data.products_json === 'string' && data.products_json.trim()) {
    try {
      const parsed = JSON.parse(data.products_json);
      if (Array.isArray(parsed) && parsed.length > 0) {
        products = parsed.map(p => {
          const uPrice = Number(p.unit_price || p.unitPrice || p.price || 0);
          const qty = Number(p.quantity || p.qty || 1);
          const lTotal = Number(p.line_total || p.lineTotal || (uPrice * qty));
          return {
            product_sku: String(p.product_sku || p.productSku || p.sku || 'VE-EQUIPMENT').trim(),
            product_name: String(p.product_name || p.productName || p.name || 'VoltEdge Hardware').trim(),
            unit_price: uPrice,
            quantity: qty,
            line_total: lTotal
          };
        });
      }
    } catch {}
  }

  if (products.length > 0) {
    if (!totalPrice || totalPrice === 0) {
      totalPrice = products.reduce((sum, p) => sum + p.line_total, 0);
    }
    const derivedUnits = products.reduce((sum, p) => sum + p.quantity, 0);
    if (derivedUnits > 0) {
      quantity = derivedUnits;
    }
    if (products.length > 1) {
      productSku = 'MULTIPLE';
      if (!data.product_name) {
        productName = products.map(p => `${p.product_name} x${p.quantity}`).join('; ');
      }
      unitPrice = totalPrice; // Combined merchandise subtotal for backward compatibility
    } else if (products.length === 1) {
      productSku = products[0].product_sku;
      productName = products[0].product_name;
      unitPrice = products[0].unit_price;
    }
  } else {
    // Single product fallback
    if (totalPrice === 0 && unitPrice > 0) {
      totalPrice = unitPrice * quantity;
    }
    products = [{
      product_sku: productSku,
      product_name: productName,
      unit_price: unitPrice || totalPrice,
      quantity: quantity,
      line_total: totalPrice || (unitPrice * quantity)
    }];
  }

  const productsJson = typeof data.products_json === 'string' && data.products_json.trim()
    ? data.products_json
    : JSON.stringify(products);

  const orderStatus = String(data.order_status || data.orderStatus || data.status || 'PENDING_PAYMENT').trim();
  const paymentStatus = String(data.payment_status || data.paymentStatus || 'PENDING').trim();
  const paymentLink = String(data.payment_link || data.paymentLink || '').trim();
  const image = String(data.image || prod.image || '').trim();
  const createdAt = data.createdAt || data.timestamp || data.orderDate || new Date().toISOString();

  return {
    order_id: orderId,
    token: token,
    lookup_token: token,
    customer_name: customerName,
    customer_email: customerEmail,
    customer_phone: customerPhone,
    delivery_address: deliveryAddress,
    delivery_state: deliveryState,
    delivery_notes: deliveryNotes,
    products: products,
    products_json: productsJson,
    product_name: productName,
    product_sku: productSku,
    quantity: quantity,
    unit_price: unitPrice,
    total_price: totalPrice,
    currency: 'NGN',
    order_status: orderStatus,
    payment_status: paymentStatus,
    payment_link: paymentLink,
    image: image,
    created_at: createdAt,
    timestamp: createdAt,
    updated_at: new Date().toISOString()
  };
}

/**
 * Persists an order record into the backend authoritative store.
 */
async function saveOrder(orderPayload) {
  const normalized = normalizeOrderRecord(orderPayload);
  if (!normalized) {
    throw new Error('Invalid order payload: Missing order_id');
  }

  const key = normalized.order_id.toLowerCase();
  
  // Preserve already confirmed payment status if re-saving existing order
  const existing = orderStore.get(key);
  if (existing) {
    if (existing.payment_status === 'PAID') {
      normalized.payment_status = 'PAID';
      normalized.order_status = existing.order_status || 'Payment Confirmed — Ready to Pack';
    }
    if (!normalized.token && existing.token) {
      normalized.token = existing.token;
      normalized.lookup_token = existing.token;
    }
  }

  // 1. In-memory store
  orderStore.set(key, normalized);

  // 2. Upstash Redis store if configured
  const redisUrl = process.env.UPSTASH_REDIS_REST_URL;
  const redisToken = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (redisUrl && redisToken) {
    try {
      const endpoint = `${redisUrl.replace(/\/$/, '')}/set/order:${encodeURIComponent(key)}`;
      await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${redisToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(normalized)
      });
    } catch (e) {
      console.warn('[VoltEdge Order Store] Redis write failed, preserved in memory:', e.message);
    }
  }

  return normalized;
}

/**
 * Retrieves an order by exact orderId and verifies lookup token.
 * Returns: { success: true, order } OR { success: false, error: '...', status: 400 | 403 | 404 }
 */
async function getOrder(orderId, token) {
  if (!orderId || typeof orderId !== 'string') {
    return {
      success: false,
      error: 'BadRequest',
      message: 'orderId is required.',
      status: 400
    };
  }

  const cleanId = orderId.trim();
  const key = cleanId.toLowerCase();

  // 1. Check in-memory store
  let record = orderStore.get(key) || null;

  // 2. Fall back to Upstash Redis if available and not found in memory
  if (!record && process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) {
    try {
      const endpoint = `${process.env.UPSTASH_REDIS_REST_URL.replace(/\/$/, '')}/get/order:${encodeURIComponent(key)}`;
      const res = await fetch(endpoint, {
        headers: { 'Authorization': `Bearer ${process.env.UPSTASH_REDIS_REST_TOKEN}` }
      });
      if (res.ok) {
        const data = await res.json();
        if (data && data.result) {
          const parsed = typeof data.result === 'string' ? JSON.parse(data.result) : data.result;
          record = normalizeOrderRecord(parsed);
          if (record) {
            orderStore.set(key, record);
          }
        }
      }
    } catch (e) {
      console.warn('[VoltEdge Order Store] Redis read error:', e.message);
    }
  }

  if (!record) {
    return {
      success: false,
      error: 'NotFound',
      message: `No order found for reference "${cleanId}".`,
      status: 404
    };
  }

  // 3. Security Token Verification:
  // If the record has a token stored, the caller must supply a matching token.
  if (record.token) {
    const suppliedToken = String(token || '').trim();
    if (!suppliedToken || suppliedToken.toLowerCase() !== record.token.toLowerCase()) {
      return {
        success: false,
        error: 'Forbidden',
        message: 'Invalid or missing security lookup token for this order.',
        status: 403
      };
    }
  }

  return {
    success: true,
    order: record,
    status: 200
  };
}

/**
 * Updates order payment/fulfillment status by exact orderId (Idempotent).
 */
async function updateOrderStatus(orderId, updateData) {
  if (!orderId || typeof orderId !== 'string') return null;

  const key = orderId.trim().toLowerCase();
  const existing = orderStore.get(key);
  if (!existing) return null;

  if (updateData.payment_status) existing.payment_status = updateData.payment_status;
  if (updateData.order_status) existing.order_status = updateData.order_status;
  if (updateData.transaction_id) existing.transaction_id = updateData.transaction_id;
  if (updateData.payment_link) existing.payment_link = updateData.payment_link;
  existing.updated_at = new Date().toISOString();

  orderStore.set(key, existing);

  // Update in Redis
  if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) {
    try {
      const endpoint = `${process.env.UPSTASH_REDIS_REST_URL.replace(/\/$/, '')}/set/order:${encodeURIComponent(key)}`;
      await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.UPSTASH_REDIS_REST_TOKEN}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(existing)
      });
    } catch {}
  }

  return existing;
}

/**
 * Resets stores (for testing purposes).
 */
function resetOrderStore() {
  orderStore.clear();
}

module.exports = {
  saveOrder,
  getOrder,
  updateOrderStatus,
  normalizeOrderRecord,
  resetOrderStore,
  orderStore
};

