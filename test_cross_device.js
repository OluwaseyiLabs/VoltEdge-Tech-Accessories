// Test Suite: Cross-Device Checkout & Order Retrieval Isolation
// Covers Tests A through F as specified in system audit.

const assert = require('assert');
const { saveOrder, getOrder, updateOrderStatus, resetOrderStore } = require('./api/_order-store');
const orderDetailsHandler = require('./api/voltedge-order-details');
const orderSubmissionHandler = require('./api/voltedge-order');

// Mock HTTP req / res helper for testing Vercel handlers
function createMockHttp(method, query = {}, body = {}, headers = {}) {
  const req = {
    method,
    query,
    body,
    headers: {
      'x-forwarded-for': '127.0.0.1',
      ...headers
    }
  };

  const res = {
    statusCode: 200,
    headers: {},
    bodyData: null,
    setHeader(k, v) { this.headers[k] = v; return this; },
    status(code) { this.statusCode = code; return this; },
    json(data) { this.bodyData = data; return this; },
    send(data) { this.bodyData = data; return this; },
    end() { return this; }
  };

  return { req, res };
}

async function runTests() {
  console.log('--- STARTING CROSS-DEVICE & ORDER ISOLATION TEST SUITE ---');
  let passed = 0;
  let failed = 0;

  function test(name, fn) {
    return (async () => {
      try {
        await fn();
        console.log(`  ✓ ${name}`);
        passed++;
      } catch (err) {
        console.error(`  ✗ ${name}:`, err.message);
        failed++;
      }
    })();
  }

  // TEST A: Same-Device Checkout Flow
  await test('Test A: Same-device checkout retrieves correct order and token', async () => {
    resetOrderStore();
    const orderA = {
      order_id: 'VE-20261030-1001',
      token: 've_tok_alice123',
      customer_name: 'Alice Johnson',
      customer_email: 'alice@example.com',
      customer_phone: '+234 801 111 2222',
      delivery_address: '10 Marina Street, Lagos Island',
      product_name: '30,000mAh Ultra Laptop Power Bank (Silver)',
      product_sku: 'VE-PB-30K-SLV',
      quantity: 1,
      unit_price: 65000,
      total_price: 65000,
      order_status: 'PENDING_PAYMENT'
    };

    const saved = await saveOrder(orderA);
    assert.strictEqual(saved.order_id, 'VE-20261030-1001');

    const lookup = await getOrder('VE-20261030-1001', 've_tok_alice123');
    assert.strictEqual(lookup.success, true);
    assert.strictEqual(lookup.order.customer_name, 'Alice Johnson');
    assert.strictEqual(lookup.order.product_name, '30,000mAh Ultra Laptop Power Bank (Silver)');
    assert.strictEqual(lookup.order.total_price, 65000);
  });

  // TEST B: Cross-Device Checkout (Order A placed on laptop, opened on phone)
  await test('Test B: Cross-device checkout retrieves Order A without browser storage dependence', async () => {
    // Device 2 has NO localStorage for Order A.
    // Device 2 only passes ?orderId=VE-20261030-1001&token=ve_tok_alice123 from payment link
    const { req, res } = createMockHttp('GET', {
      orderId: 'VE-20261030-1001',
      token: 've_tok_alice123'
    });

    await orderDetailsHandler(req, res);
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.bodyData.success, true);
    assert.strictEqual(res.bodyData.order.order_id, 'VE-20261030-1001');
    assert.strictEqual(res.bodyData.order.customer_name, 'Alice Johnson');
    assert.strictEqual(res.bodyData.order.delivery_address, '10 Marina Street, Lagos Island');
  });

  // TEST C: Multiple Customers (Order A placed, then Order B placed. Order A paid afterwards)
  await test('Test C: Multiple customers never cross-contaminate details', async () => {
    // Order A is Alice
    // Order B is Bob placed AFTER Alice
    const orderB = {
      order_id: 'VE-20261030-2002',
      token: 've_tok_bob456',
      customer_name: 'Bob Smith',
      customer_email: 'bob@smith.org',
      customer_phone: '+234 802 333 4444',
      delivery_address: '45 Admiralty Way, Lekki Phase 1',
      product_name: '100W GaN Super Fast Charger',
      product_sku: 'VE-CHG-100W',
      quantity: 2,
      unit_price: 25000,
      total_price: 50000,
      order_status: 'PENDING_PAYMENT'
    };

    await saveOrder(orderB);

    // Customer A opens payment link on Device 2 (which might have Bob cached in localStorage)
    // Serverless endpoint MUST return Alice, NEVER Bob
    const { req: reqA, res: resA } = createMockHttp('GET', {
      orderId: 'VE-20261030-1001',
      token: 've_tok_alice123'
    });
    await orderDetailsHandler(reqA, resA);
    assert.strictEqual(resA.statusCode, 200);
    assert.strictEqual(resA.bodyData.order.customer_name, 'Alice Johnson');
    assert.strictEqual(resA.bodyData.order.product_sku, 'VE-PB-30K-SLV');
    assert.strictEqual(resA.bodyData.order.total_price, 65000);

    // Verify Bob's lookup returns Bob
    const { req: reqB, res: resB } = createMockHttp('GET', {
      orderId: 'VE-20261030-2002',
      token: 've_tok_bob456'
    });
    await orderDetailsHandler(reqB, resB);
    assert.strictEqual(resB.statusCode, 200);
    assert.strictEqual(resB.bodyData.order.customer_name, 'Bob Smith');
    assert.strictEqual(resB.bodyData.order.product_sku, 'VE-CHG-100W');
    assert.strictEqual(resB.bodyData.order.total_price, 50000);
  });

  // TEST D: Concurrent Orders
  await test('Test D: Concurrent order creation and lookup in randomized order', async () => {
    const orders = [];
    for (let i = 1; i <= 5; i++) {
      orders.push({
        order_id: `VE-20261030-CONCUR-${i}`,
        token: `ve_tok_concurrent_${i}`,
        customer_name: `Customer ${i}`,
        customer_email: `customer${i}@test.com`,
        customer_phone: `+234 800 000 000${i}`,
        delivery_address: `${i} Test Street, Ikeja`,
        product_name: `Test Product ${i}`,
        product_sku: `VE-TEST-SKU-${i}`,
        quantity: i,
        unit_price: 10000,
        total_price: 10000 * i
      });
    }

    // Save all concurrently
    await Promise.all(orders.map(o => saveOrder(o)));

    // Read back in reverse order
    const reverseIndices = [4, 2, 0, 3, 1];
    for (const idx of reverseIndices) {
      const target = orders[idx];
      const lookup = await getOrder(target.order_id, target.token);
      assert.strictEqual(lookup.success, true);
      assert.strictEqual(lookup.order.customer_name, target.customer_name);
      assert.strictEqual(lookup.order.total_price, target.total_price);
      assert.strictEqual(lookup.order.product_sku, target.product_sku);
    }
  });

  // TEST E: Invalid Lookup & Token Tampering Security
  await test('Test E1: Non-existent order returns 404', async () => {
    const { req, res } = createMockHttp('GET', {
      orderId: 'VE-NONEXISTENT-9999',
      token: 'any_tok'
    });
    await orderDetailsHandler(req, res);
    assert.strictEqual(res.statusCode, 404);
    assert.strictEqual(res.bodyData.success, false);
  });

  await test('Test E2: Token mismatch returns 403 Forbidden', async () => {
    // Attempting to access Alice's order with Bob's token or forged token
    const { req, res } = createMockHttp('GET', {
      orderId: 'VE-20261030-1001',
      token: 've_tok_forged_hacker_token'
    });
    await orderDetailsHandler(req, res);
    assert.strictEqual(res.statusCode, 403);
    assert.strictEqual(res.bodyData.error, 'Forbidden');
  });

  await test('Test E3: Missing token returns 403 Forbidden', async () => {
    const { req, res } = createMockHttp('GET', {
      orderId: 'VE-20261030-1001'
    });
    await orderDetailsHandler(req, res);
    assert.strictEqual(res.statusCode, 403);
    assert.strictEqual(res.bodyData.error, 'Forbidden');
  });

  await test('Test E4: Missing orderId returns 400 Bad Request', async () => {
    const { req, res } = createMockHttp('GET', {});
    await orderDetailsHandler(req, res);
    assert.strictEqual(res.statusCode, 400);
    assert.strictEqual(res.bodyData.error, 'BadRequest');
  });

  await test('Test E5: Mock ID VE-20261029-5826 is rejected with 404', async () => {
    const { req, res } = createMockHttp('GET', {
      orderId: 'VE-20261029-5826',
      token: 'any'
    });
    await orderDetailsHandler(req, res);
    assert.strictEqual(res.statusCode, 404);
  });

  // TEST F: Idempotent Payment Webhook Processing
  await test('Test F: Repeated payment confirmation is idempotent', async () => {
    const initial = await getOrder('VE-20261030-1001', 've_tok_alice123');
    assert.strictEqual(initial.order.payment_status, 'PENDING');

    // First update: mark PAID with transaction id
    const update1 = await updateOrderStatus('VE-20261030-1001', {
      payment_status: 'PAID',
      order_status: 'Payment Confirmed — Ready to Pack',
      transaction_id: 'bachs_trx_987654321'
    });
    assert.strictEqual(update1.payment_status, 'PAID');
    assert.strictEqual(update1.transaction_id, 'bachs_trx_987654321');

    // Second webhook delivery (replay/duplicate):
    const update2 = await updateOrderStatus('VE-20261030-1001', {
      payment_status: 'PAID',
      order_status: 'Payment Confirmed — Ready to Pack',
      transaction_id: 'bachs_trx_987654321'
    });
    assert.strictEqual(update2.payment_status, 'PAID');

    // Verify record state is maintained accurately
    const finalLookup = await getOrder('VE-20261030-1001', 've_tok_alice123');
    assert.strictEqual(finalLookup.order.payment_status, 'PAID');
    assert.strictEqual(finalLookup.order.order_status, 'Payment Confirmed — Ready to Pack');
    assert.strictEqual(finalLookup.order.transaction_id, 'bachs_trx_987654321');
  });

  console.log(`\n========================================`);
  console.log(`TEST RESULTS: ${passed} passed, ${failed} failed`);
  console.log(`========================================`);

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error('Test runner error:', err);
  process.exit(1);
});

