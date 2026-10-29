// Vercel Serverless Function: Secure Customer Feedback / Contact Form Proxy
// Enforces 5 requests / 1 minute rate limit.

const { rateLimitMiddleware } = require('./_rate-limiter');

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
  const allowed = await rateLimitMiddleware(req, res, 'feedback');
  if (!allowed) {
    return; // 429 response already sent with Retry-After header
  }

  let bodyObj = {};
  try {
    bodyObj = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
  } catch {
    bodyObj = {};
  }

  const name = String(bodyObj.name || '').trim();
  const message = String(bodyObj.message || '').trim();

  if (name.length < 2 || message.length < 5) {
    return res.status(400).json({
      success: false,
      message: 'Invalid feedback submission. Name (min 2 chars) and message (min 5 chars) are required.'
    });
  }

  // If a feedback webhook is configured, forward it; otherwise confirm acceptance
  const feedbackWebhookUrl = process.env.VOLTEDGE_FEEDBACK_WEBHOOK_URL;
  if (feedbackWebhookUrl) {
    try {
      await fetch(feedbackWebhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, message, timestamp: new Date().toISOString() })
      });
    } catch (e) {
      console.warn('[VoltEdge API] Feedback forwarding warning:', e.message);
    }
  }

  return res.status(200).json({
    success: true,
    message: 'Thank you for your feedback! Our team has received your message.'
  });
};

