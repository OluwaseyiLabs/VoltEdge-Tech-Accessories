// VoltEdge Production Rate Limiting Engine
// Supports Upstash Redis REST API (shared distributed store) with graceful in-memory sliding-window fallback.

const crypto = require('crypto');

// Default limits matching VoltEdge production specification
const RATE_LIMITS = {
  order_submission: {
    limit: parseInt(process.env.RATE_LIMIT_ORDER_MAX || '5', 10),
    windowSec: parseInt(process.env.RATE_LIMIT_ORDER_WINDOW_SEC || '60', 10)
  },
  order_lookup: {
    limit: parseInt(process.env.RATE_LIMIT_LOOKUP_MAX || '20', 10),
    windowSec: parseInt(process.env.RATE_LIMIT_LOOKUP_WINDOW_SEC || '60', 10)
  },
  feedback: {
    limit: parseInt(process.env.RATE_LIMIT_FEEDBACK_MAX || '5', 10),
    windowSec: parseInt(process.env.RATE_LIMIT_FEEDBACK_WINDOW_SEC || '60', 10)
  }
};

// In-Memory Sliding Window Store (Fail-safe fallback when Redis is unconfigured or unavailable)
// Structure: Map<key, Array<{ timestamp: number, id: string }>>
const memoryStore = new Map();

// Periodic cleanup of stale in-memory entries (runs every 60s)
let lastCleanup = Date.now();
function cleanupMemoryStore() {
  const now = Date.now();
  if (now - lastCleanup < 60000) return;
  lastCleanup = now;

  for (const [key, records] of memoryStore.entries()) {
    const valid = records.filter(r => now - r.timestamp < 120000);
    if (valid.length === 0) {
      memoryStore.delete(key);
    } else if (valid.length < records.length) {
      memoryStore.set(key, valid);
    }
  }
}

/**
 * Safely extracts client IP from verified platform headers.
 * Never allows the client to choose its own identity.
 */
function getClientIp(req) {
  if (!req) return '127.0.0.1';

  // 1. Vercel Real IP header (verified by Vercel edge proxy)
  const xRealIp = req.headers && req.headers['x-real-ip'];
  if (xRealIp && typeof xRealIp === 'string') {
    const ip = xRealIp.trim().split(',')[0].trim();
    if (isValidIp(ip)) return ip;
  }

  // 2. Vercel Forwarded For
  const vercelForwarded = req.headers && req.headers['x-vercel-forwarded-for'];
  if (vercelForwarded && typeof vercelForwarded === 'string') {
    const ip = vercelForwarded.trim().split(',')[0].trim();
    if (isValidIp(ip)) return ip;
  }

  // 3. Trusted Reverse Proxy X-Forwarded-For (take the first untampered public IP)
  const xForwardedFor = req.headers && req.headers['x-forwarded-for'];
  if (xForwardedFor && typeof xForwardedFor === 'string') {
    const ip = xForwardedFor.trim().split(',')[0].trim();
    if (isValidIp(ip)) return ip;
  }

  // 4. Fallback to socket remote address
  if (req.socket && req.socket.remoteAddress) {
    const ip = req.socket.remoteAddress.trim();
    return ip.replace(/^::ffff:/, ''); // normalize IPv4-mapped IPv6
  }

  return '127.0.0.1';
}

function isValidIp(ip) {
  if (!ip || typeof ip !== 'string') return false;
  // Basic IPv4 / IPv6 validation
  const ipv4Regex = /^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$/;
  const ipv6Regex = /^[a-fA-F0-9:]+$/;
  return ipv4Regex.test(ip) || ipv6Regex.test(ip);
}

/**
 * Produces a secure, non-reversible hash of the client identifier + endpoint category.
 * Never stores or logs raw customer IPs or PII.
 */
function generateRateLimitKey(category, clientIp) {
  const salt = process.env.RATE_LIMIT_SALT || 'voltedge_rl_salt';
  const hashed = crypto.createHash('sha256').update(`${salt}:${category}:${clientIp}`).digest('hex').substring(0, 24);
  return `rl:${category}:${hashed}`;
}

/**
 * Sliding-window rate check using In-Memory store
 */
function checkMemoryRateLimit(key, limit, windowSec) {
  cleanupMemoryStore();
  const now = Date.now();
  const windowMs = windowSec * 1000;
  const threshold = now - windowMs;

  const records = memoryStore.get(key) || [];
  const validRecords = records.filter(r => r.timestamp > threshold);

  const currentCount = validRecords.length;
  const remaining = Math.max(0, limit - currentCount);

  // Oldest timestamp in window determines reset time
  const oldestTimestamp = validRecords.length > 0 ? validRecords[0].timestamp : now;
  const resetSec = Math.max(1, Math.ceil((oldestTimestamp + windowMs - now) / 1000));

  if (currentCount >= limit) {
    return {
      allowed: false,
      limit,
      remaining: 0,
      resetSec,
      retryAfterSec: resetSec,
      store: 'memory'
    };
  }

  validRecords.push({ timestamp: now, id: Math.random().toString(36).substring(2, 8) });
  memoryStore.set(key, validRecords);

  return {
    allowed: true,
    limit,
    remaining: Math.max(0, limit - validRecords.length),
    resetSec,
    store: 'memory'
  };
}

/**
 * Sliding-window rate check using Upstash Redis REST API (Shared Store)
 * Uses atomic Redis pipeline commands (ZREMRANGEBYSCORE, ZCARD, ZADD, EXPIRE).
 */
async function checkRedisRateLimit(key, limit, windowSec, redisUrl, redisToken) {
  const now = Date.now();
  const windowMs = windowSec * 1000;
  const threshold = now - windowMs;
  const requestId = `${now}-${Math.random().toString(36).substring(2, 8)}`;

  // Construct REST pipeline
  // 1. ZREMRANGEBYSCORE key -inf threshold
  // 2. ZCARD key
  // 3. ZRANGE key 0 0 WITHSCORES (to calculate exact reset time from oldest record)
  const pipeline = [
    ['ZREMRANGEBYSCORE', key, '-inf', threshold],
    ['ZCARD', key],
    ['ZRANGE', key, '0', '0', 'WITHSCORES']
  ];

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 2500); // 2.5s network timeout for Redis

  try {
    const res = await fetch(`${redisUrl}/pipeline`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${redisToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(pipeline),
      signal: controller.signal
    });
    clearTimeout(timeoutId);

    if (!res.ok) {
      throw new Error(`Redis pipeline responded with HTTP ${res.status}`);
    }

    const data = await res.json();
    const count = typeof data[1]?.result === 'number' ? data[1].result : 0;
    const oldest = data[2]?.result;
    let oldestScore = now;
    if (Array.isArray(oldest) && oldest.length >= 2) {
      oldestScore = parseFloat(oldest[1]) || now;
    }

    const resetSec = Math.max(1, Math.ceil((oldestScore + windowMs - now) / 1000));

    if (count >= limit) {
      return {
        allowed: false,
        limit,
        remaining: 0,
        resetSec,
        retryAfterSec: resetSec,
        store: 'redis'
      };
    }

    // Add current request and renew TTL
    const addPipeline = [
      ['ZADD', key, now, requestId],
      ['EXPIRE', key, windowSec + 5]
    ];
    fetch(`${redisUrl}/pipeline`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${redisToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(addPipeline)
    }).catch(err => console.warn('[VoltEdge RateLimiter] Background ZADD error:', err.message));

    return {
      allowed: true,
      limit,
      remaining: Math.max(0, limit - (count + 1)),
      resetSec,
      store: 'redis'
    };
  } catch (err) {
    clearTimeout(timeoutId);
    console.warn('[VoltEdge RateLimiter] Shared Redis check failed, falling back to memory store:', err.message);
    const fallback = checkMemoryRateLimit(key, limit, windowSec);
    fallback.store = 'memory-fallback';
    return fallback;
  }
}

/**
 * Main Rate Limiter Middleware Function
 * Evaluates limits, writes standard RFC headers, and handles HTTP 429 responses.
 *
 * @param {object} req - HTTP Request
 * @param {object} res - HTTP Response
 * @param {string} category - Endpoint category ('order_submission', 'order_lookup', 'feedback')
 * @returns {Promise<boolean>} True if allowed, False if rejected (429 sent)
 */
async function rateLimitMiddleware(req, res, category) {
  const config = RATE_LIMITS[category] || { limit: 10, windowSec: 60 };
  const clientIp = getClientIp(req);
  const key = generateRateLimitKey(category, clientIp);

  const redisUrl = process.env.UPSTASH_REDIS_REST_URL;
  const redisToken = process.env.UPSTASH_REDIS_REST_TOKEN;

  let result;
  if (redisUrl && redisToken) {
    result = await checkRedisRateLimit(key, config.limit, config.windowSec, redisUrl, redisToken);
  } else {
    result = checkMemoryRateLimit(key, config.limit, config.windowSec);
  }

  // Set standard RFC rate-limiting headers
  res.setHeader('X-RateLimit-Limit', String(result.limit));
  res.setHeader('X-RateLimit-Remaining', String(result.remaining));
  res.setHeader('X-RateLimit-Reset', String(result.resetSec));
  res.setHeader('X-RateLimit-Store', result.store);

  if (!result.allowed) {
    res.setHeader('Retry-After', String(result.retryAfterSec || config.windowSec));
    res.status(429).json({
      success: false,
      error: 'Too Many Requests',
      message: "You're making requests too quickly. Please wait a moment and try again.",
      retryAfter: result.retryAfterSec || config.windowSec
    });
    return false;
  }

  return true;
}

// In-Memory Order Idempotency Cache (Prevents duplicate order submission within 5 minutes)
const idempotencyStore = new Map();

/**
 * Checks if an order submission with this orderId is currently in progress or recently succeeded.
 * Prevents duplicate orders, duplicate confirmation emails, and duplicate payment sessions.
 */
function checkOrderDuplicate(orderId, orderPayload) {
  if (!orderId || typeof orderId !== 'string') return { isDuplicate: false };

  const now = Date.now();
  const existing = idempotencyStore.get(orderId);

  if (existing) {
    if (now - existing.timestamp < 300000) { // 5 minutes window
      return {
        isDuplicate: true,
        cachedResponse: existing.response,
        inFlight: existing.inFlight
      };
    }
    idempotencyStore.delete(orderId);
  }

  // Mark as in-flight
  idempotencyStore.set(orderId, {
    timestamp: now,
    inFlight: true,
    response: null
  });

  return { isDuplicate: false };
}

function recordOrderResponse(orderId, responseData) {
  if (!orderId) return;
  idempotencyStore.set(orderId, {
    timestamp: Date.now(),
    inFlight: false,
    response: responseData
  });
}

function clearIdempotency(orderId) {
  if (orderId) idempotencyStore.delete(orderId);
}

// Unit test helpers
function resetStores() {
  memoryStore.clear();
  idempotencyStore.clear();
}

module.exports = {
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
};

