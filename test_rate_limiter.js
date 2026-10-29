// VoltEdge Automated Test Suite for Rate Limiting & Security
// Validates all 11 criteria specified in the security task.

const assert = require('assert');
const {
  rateLimitMiddleware,
  getClientIp,
  generateRateLimitKey,
  checkMemoryRateLimit,
  checkRedisRateLimit,
  checkOrderDuplicate,
  recordOrderResponse,
  clearIdempotency,
  resetStores,
  RATE_LIMITS
} = require('./api/_rate-limiter');

function mockReq(options = {}) {
  return {
    headers: options.headers || {},
    socket: { remoteAddress: options.remoteAddress || '192.168.1.1' },
    body: options.body || {},
    query: options.query || {}
  };
}

function mockRes() {
  const res = {
    statusCode: 200,
    headers: {},
    body: null,
    setHeader(name, val) {
      this.headers[name.toLowerCase()] = String(val);
      return this;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(data) {
      this.body = data;
      return this;
    },
    end() {
      return this;
    }
  };
  return res;
}

let passedTests = 0;
let failedTests = 0;

function it(name, fn) {
  try {
    fn();
    console.log(`PASS: ${name}`);
    passedTests++;
  } catch (err) {
    console.error(`FAIL: ${name}`);
    console.error(`  Error: ${err.message}`);
    failedTests++;
  }
}

async function itAsync(name, fn) {
  try {
    await fn();
    console.log(`PASS: ${name}`);
    passedTests++;
  } catch (err) {
    console.error(`FAIL: ${name}`);
    console.error(`  Error: ${err.message}`);
    failedTests++;
  }
}

async function runTestSuite() {
  console.log('\n--- STARTING VOLTEDGE RATE LIMITER TEST SUITE ---\n');

  // Test 1: Requests within allowed limit
  await itAsync('1. Allows requests within the configured limit (e.g. 5 order submissions)', async () => {
    resetStores();
    const clientIp = '10.0.0.1';
    for (let i = 1; i <= 5; i++) {
      const req = mockReq({ headers: { 'x-real-ip': clientIp } });
      const res = mockRes();
      const allowed = await rateLimitMiddleware(req, res, 'order_submission');
      assert.strictEqual(allowed, true, `Request #${i} should be allowed`);
      assert.strictEqual(res.statusCode, 200);
      assert.strictEqual(res.headers['x-ratelimit-remaining'], String(5 - i));
      assert.strictEqual(res.headers['x-ratelimit-limit'], '5');
    }
  });

  // Test 2: Requests exceeding the limit
  await itAsync('2. Rejects request exceeding configured limit with HTTP 429', async () => {
    const clientIp = '10.0.0.1'; // Same client from Test 1 (already made 5 requests)
    const req = mockReq({ headers: { 'x-real-ip': clientIp } });
    const res = mockRes();
    const allowed = await rateLimitMiddleware(req, res, 'order_submission');

    assert.strictEqual(allowed, false, '6th request must be rejected');
    assert.strictEqual(res.statusCode, 429, 'HTTP status must be 429');
    assert.strictEqual(res.headers['x-ratelimit-remaining'], '0');
  });

  // Test 3: HTTP 429 responses and Retry-After
  await itAsync('3. Returns correct 429 JSON response structure and Retry-After header', async () => {
    const clientIp = '10.0.0.1';
    const req = mockReq({ headers: { 'x-real-ip': clientIp } });
    const res = mockRes();
    await rateLimitMiddleware(req, res, 'order_submission');

    assert.ok(res.headers['retry-after'], 'Must contain Retry-After header');
    assert.ok(parseInt(res.headers['retry-after'], 10) > 0, 'Retry-After must be positive integer');
    assert.strictEqual(res.body.success, false);
    assert.strictEqual(res.body.error, 'Too Many Requests');
    assert.strictEqual(
      res.body.message,
      "You're making requests too quickly. Please wait a moment and try again."
    );
    assert.strictEqual(res.body.retryAfter, parseInt(res.headers['retry-after'], 10));
  });

  // Test 4: Rate-limit window expiration
  it('4. Resets counters when window expires', () => {
    resetStores();
    const key = 'test_window_exp';
    const limit = 3;
    const windowSec = 1; // 1 second window for test

    // Fill to limit
    checkMemoryRateLimit(key, limit, windowSec);
    checkMemoryRateLimit(key, limit, windowSec);
    const r3 = checkMemoryRateLimit(key, limit, windowSec);
    assert.strictEqual(r3.allowed, true);

    // 4th request blocked
    const r4 = checkMemoryRateLimit(key, limit, windowSec);
    assert.strictEqual(r4.allowed, false);

    // Simulate window expiration by manually testing threshold
    const expiredResult = checkMemoryRateLimit(key, limit, 0); // 0-second window forces expiration
    assert.strictEqual(expiredResult.allowed, true, 'Request after window expiration must be allowed');
  });

  // Test 5: Different clients receive separate limits
  await itAsync('5. Isolates rate limits between different clients', async () => {
    resetStores();
    const clientA = '172.16.0.10';
    const clientB = '172.16.0.20';

    // Exhaust client A
    for (let i = 0; i < 5; i++) {
      const reqA = mockReq({ headers: { 'x-real-ip': clientA } });
      const resA = mockRes();
      await rateLimitMiddleware(reqA, resA, 'order_submission');
    }

    const reqA_blocked = mockReq({ headers: { 'x-real-ip': clientA } });
    const resA_blocked = mockRes();
    const allowedA = await rateLimitMiddleware(reqA_blocked, resA_blocked, 'order_submission');
    assert.strictEqual(allowedA, false, 'Client A must be blocked');

    // Client B must still have full allowance
    const reqB = mockReq({ headers: { 'x-real-ip': clientB } });
    const resB = mockRes();
    const allowedB = await rateLimitMiddleware(reqB, resB, 'order_submission');
    assert.strictEqual(allowedB, true, 'Client B must NOT be blocked by Client A');
    assert.strictEqual(resB.headers['x-ratelimit-remaining'], '4');
  });

  // Test 6: Handling of missing or invalid client identity information
  it('6. Safely handles missing, invalid, or malformed client IP metadata', () => {
    assert.strictEqual(getClientIp(null), '127.0.0.1');
    assert.strictEqual(getClientIp({}), '127.0.0.1');
    assert.strictEqual(getClientIp({ headers: {} }), '127.0.0.1');
    assert.strictEqual(getClientIp({ headers: { 'x-real-ip': 'invalid_ip_format' }, socket: { remoteAddress: '10.5.5.5' } }), '10.5.5.5');
    assert.strictEqual(getClientIp({ headers: { 'x-forwarded-for': '198.51.100.5, 10.0.0.1' } }), '198.51.100.5');
    assert.strictEqual(getClientIp({ headers: { 'x-vercel-forwarded-for': '203.0.113.19' } }), '203.0.113.19');
  });

  // Test 7: Rate-limit storage failures fail-safe
  await itAsync('7. Fails safely to in-memory store if shared Redis connection fails', async () => {
    const key = 'test_redis_fail';
    // Provide an invalid URL that will fail connection
    const badRedisUrl = 'http://127.0.0.1:54321/nonexistent';
    const badRedisToken = 'invalid_token';

    const result = await checkRedisRateLimit(key, 5, 60, badRedisUrl, badRedisToken);
    assert.strictEqual(result.allowed, true, 'Must fail-open or fallback safely to memory store without crashing');
    assert.strictEqual(result.store, 'memory-fallback', 'Store should report memory-fallback');
  });

  // Test 8: Legitimate order submission handler
  await itAsync('8. Verifies legitimate order submission handler integration', async () => {
    resetStores();
    const orderHandler = require('./api/voltedge-order');
    const req = mockReq({
      headers: { 'x-real-ip': '10.10.10.10' },
      body: {
        orderId: 'VE-TEST-001',
        customer_name: 'Test Customer',
        total_price: 65000
      }
    });
    req.method = 'POST';
    const res = mockRes();

    // Call handler (mocking global fetch if offline)
    const originalFetch = global.fetch;
    global.fetch = async () => ({
      ok: true,
      status: 200,
      headers: { get: () => 'application/json' },
      json: async () => ({ success: true, orderId: 'VE-TEST-001', message: 'Order received' })
    });

    await orderHandler(req, res);
    global.fetch = originalFetch;

    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body.success, true);
    assert.strictEqual(res.headers['x-ratelimit-remaining'], '4');
  });

  // Test 9: Duplicate order-submission behavior (Idempotency)
  it('9. Idempotency prevents duplicate order submission and duplicate sessions', () => {
    resetStores();
    const testOrderId = 'VE-DUP-TEST-001';
    const payload = { customer_name: 'Idempotent Buyer' };

    // First attempt: Not duplicate
    const check1 = checkOrderDuplicate(testOrderId, payload);
    assert.strictEqual(check1.isDuplicate, false);

    // Immediate second attempt while in flight: marked as duplicate inFlight
    const check2 = checkOrderDuplicate(testOrderId, payload);
    assert.strictEqual(check2.isDuplicate, true);
    assert.strictEqual(check2.inFlight, true);

    // Record verified backend response
    recordOrderResponse(testOrderId, { success: true, orderId: testOrderId, payment_link: 'https://bachs.co/pay/123' });

    // Third attempt: returns cached response
    const check3 = checkOrderDuplicate(testOrderId, payload);
    assert.strictEqual(check3.isDuplicate, true);
    assert.strictEqual(check3.cachedResponse.payment_link, 'https://bachs.co/pay/123');
  });

  // Test 10: Existing order-status lookup rate limit
  await itAsync('10. Order-status lookup allows 20 queries/minute before rate limiting', async () => {
    resetStores();
    const clientIp = '10.20.30.40';
    for (let i = 1; i <= 20; i++) {
      const req = mockReq({ headers: { 'x-real-ip': clientIp } });
      const res = mockRes();
      const allowed = await rateLimitMiddleware(req, res, 'order_lookup');
      assert.strictEqual(allowed, true, `Lookup #${i} should be allowed`);
    }

    // 21st lookup must be rate limited
    const req21 = mockReq({ headers: { 'x-real-ip': clientIp } });
    const res21 = mockRes();
    const allowed21 = await rateLimitMiddleware(req21, res21, 'order_lookup');
    assert.strictEqual(allowed21, false, '21st lookup must be rate limited');
    assert.strictEqual(res21.statusCode, 429);
  });

  // Test 11: Feedback form endpoint rate limiting
  await itAsync('11. Feedback/contact endpoint limits to 5 requests/minute', async () => {
    resetStores();
    const clientIp = '10.30.50.70';
    for (let i = 1; i <= 5; i++) {
      const req = mockReq({ headers: { 'x-real-ip': clientIp } });
      const res = mockRes();
      const allowed = await rateLimitMiddleware(req, res, 'feedback');
      assert.strictEqual(allowed, true);
    }

    const req6 = mockReq({ headers: { 'x-real-ip': clientIp } });
    const res6 = mockRes();
    const allowed6 = await rateLimitMiddleware(req6, res6, 'feedback');
    assert.strictEqual(allowed6, false);
    assert.strictEqual(res6.statusCode, 429);
  });

  console.log(`\n--- TEST SUITE COMPLETE: ${passedTests} PASSED, ${failedTests} FAILED ---`);
  if (failedTests > 0) {
    process.exit(1);
  }
}

runTestSuite();

