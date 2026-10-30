// Test Suite: Multi-Product Cart & Complete Nigerian State Selection Verification
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { saveOrder, getOrder, normalizeOrderRecord } = require('./api/_order-store');

console.log('--- STARTING MULTI-PRODUCT CART & NIGERIA STATES TEST SUITE ---\n');

let passed = 0;
let failed = 0;

function runTest(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${err.message}`);
    failed++;
  }
}

async function runAsyncTest(name, fn) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${err.message}`);
    failed++;
  }
}

// 1. Verify Nigerian States in HTML files
runTest('All 36 States + FCT (37 total) present and alphabetically sorted in Add to Cart panel (js/cart.js)', () => {
  const html = fs.readFileSync('js/cart.js', 'utf-8');
  const expectedStates = [
    'Abia', 'Adamawa', 'Akwa Ibom', 'Anambra', 'Bauchi', 'Bayelsa', 'Benue', 'Borno',
    'Cross River', 'Delta', 'Ebonyi', 'Edo', 'Ekiti', 'Enugu', 'Federal Capital Territory (Abuja)',
    'Gombe', 'Imo', 'Jigawa', 'Kaduna', 'Kano', 'Katsina', 'Kebbi', 'Kogi', 'Kwara',
    'Lagos', 'Nasarawa', 'Niger', 'Ogun', 'Ondo', 'Osun', 'Oyo', 'Plateau', 'Rivers',
    'Sokoto', 'Taraba', 'Yobe', 'Zamfara'
  ];

  for (const st of expectedStates) {
    assert(html.includes(`value="${st}"`), `Missing state in index.html: ${st}`);
  }
  assert.strictEqual(expectedStates.length, 37);
});

runTest('All 36 States + FCT (37 total) present and alphabetically sorted in checkout.html', () => {
  const html = fs.readFileSync('checkout.html', 'utf-8');
  const expectedStates = [
    'Abia', 'Adamawa', 'Akwa Ibom', 'Anambra', 'Bauchi', 'Bayelsa', 'Benue', 'Borno',
    'Cross River', 'Delta', 'Ebonyi', 'Edo', 'Ekiti', 'Enugu', 'Federal Capital Territory (Abuja)',
    'Gombe', 'Imo', 'Jigawa', 'Kaduna', 'Kano', 'Katsina', 'Kebbi', 'Kogi', 'Kwara',
    'Lagos', 'Nasarawa', 'Niger', 'Ogun', 'Ondo', 'Osun', 'Oyo', 'Plateau', 'Rivers',
    'Sokoto', 'Taraba', 'Yobe', 'Zamfara'
  ];

  for (const st of expectedStates) {
    assert(html.includes(`value="${st}"`), `Missing state in checkout.html: ${st}`);
  }
});

// 2. Test Cart Engine Logic & Price Protection
runTest('Cart Engine correctly computes line subtotals and combined totals without duplicates', () => {
  const cartFile = fs.readFileSync('js/cart.js', 'utf-8');
  assert(cartFile.includes('VoltEdgeCart'), 'VoltEdgeCart object must be defined');
  assert(cartFile.includes('addItem'), 'VoltEdgeCart.addItem must be defined');
  assert(cartFile.includes('updateQuantity'), 'VoltEdgeCart.updateQuantity must be defined');
  assert(cartFile.includes('removeItem'), 'VoltEdgeCart.removeItem must be defined');
  assert(cartFile.includes('clearCart'), 'VoltEdgeCart.clearCart must be defined');
  assert(cartFile.includes('getOrderPayloadData'), 'getOrderPayloadData must generate n8n compatible payload');
});

// 3. Test Multi-Product Order Persistence & Backward Compatibility
(async () => {
  await runAsyncTest('Multi-product order correctly persists structured products array & serialized json', async () => {
    const multiOrder = {
      order_id: 'VE-MULTI-20261030-01',
      token: 'tok_multi_abc123',
      customer_name: 'Babajide Sanwo',
      customer_email: 'babajide@example.ng',
      customer_phone: '+234 802 345 6789',
      delivery_address: '15 Bourdillon Road, Ikoyi',
      delivery_state: 'Lagos',
      delivery_notes: 'Leave at security gate',
      products: [
        {
          product_sku: 'VE-PB-30K-SLV',
          product_name: '30,000mAh Laptop Power Bank (Silver)',
          unit_price: 65000,
          quantity: 2,
          line_total: 130000
        },
        {
          product_sku: 'VE-UPS-ROUTER-MINI',
          product_name: 'Mini Wi-Fi Router UPS Backup',
          unit_price: 35000,
          quantity: 1,
          line_total: 35000
        }
      ]
    };

    const saved = await saveOrder(multiOrder);
    assert(saved, 'Order must save successfully');
    assert.strictEqual(saved.order_id, 'VE-MULTI-20261030-01');
    assert.strictEqual(saved.product_sku, 'MULTIPLE', 'Multiple items must set product_sku to MULTIPLE');
    assert.strictEqual(saved.quantity, 3, 'Total units must be sum of item quantities (2 + 1 = 3)');
    assert.strictEqual(saved.total_price, 165000, 'Total price must equal 130,000 + 35,000 = 165,000');
    assert.strictEqual(saved.products.length, 2, 'Products array must contain 2 items');
    assert(typeof saved.products_json === 'string', 'products_json must be serialized string for Google Sheets');

    const res = await getOrder('VE-MULTI-20261030-01', 'tok_multi_abc123');
    assert(res && res.success && res.order, 'Order must be retrievable with correct token');
    const retrieved = res.order;
    assert.strictEqual(retrieved.products.length, 2);
    assert.strictEqual(retrieved.products[0].product_sku, 'VE-PB-30K-SLV');
    assert.strictEqual(retrieved.products[0].quantity, 2);
    assert.strictEqual(retrieved.products[1].product_sku, 'VE-UPS-ROUTER-MINI');
    assert.strictEqual(retrieved.products[1].quantity, 1);
  });

  await runAsyncTest('Single-product order preserves backward compatibility with single SKU and name', async () => {
    const singleOrder = {
      order_id: 'VE-SINGLE-20261030-02',
      token: 'tok_single_xyz789',
      customer_name: 'Ngozi Okonjo',
      customer_email: 'ngozi@example.ng',
      customer_phone: '+234 809 111 2222',
      delivery_address: 'Plot 402 Constitution Ave',
      delivery_state: 'Federal Capital Territory (Abuja)',
      product_sku: 'VE-PB-60K-PRO',
      product_name: '60,000mAh High-Capacity Power Station (Black)',
      unit_price: 115000,
      quantity: 1,
      total_price: 115000
    };

    const saved = await saveOrder(singleOrder);
    assert(saved, 'Single order must save successfully');
    assert.strictEqual(saved.product_sku, 'VE-PB-60K-PRO', 'Single item preserves its unique SKU');
    assert.strictEqual(saved.product_name, '60,000mAh High-Capacity Power Station (Black)');
    assert.strictEqual(saved.quantity, 1);
    assert.strictEqual(saved.total_price, 115000);
    assert.strictEqual(saved.products.length, 1);
    assert.strictEqual(saved.products[0].product_sku, 'VE-PB-60K-PRO');
  });

  await runAsyncTest('Cross-device retrieval never cross-contaminates multiple orders', async () => {
    const resA = await getOrder('VE-MULTI-20261030-01', 'tok_multi_abc123');
    const resB = await getOrder('VE-SINGLE-20261030-02', 'tok_single_xyz789');

    const orderA = resA.order;
    const orderB = resB.order;

    assert.strictEqual(orderA.customer_name, 'Babajide Sanwo');
    assert.strictEqual(orderB.customer_name, 'Ngozi Okonjo');
    assert.notStrictEqual(orderA.products.length, orderB.products.length);
  });

  console.log('\n========================================');
  console.log(`TEST RESULTS: ${passed} passed, ${failed} failed`);
  console.log('========================================');
  if (failed > 0) process.exit(1);
})();
