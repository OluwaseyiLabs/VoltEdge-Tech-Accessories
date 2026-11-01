// Vercel Serverless Function: Bachs Payment Webhook Handler
// Idempotently confirms payment and commits stock deduction in Supabase.

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Bachs-Signature');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, message: 'Method Not Allowed' });
  }

  let body = {};
  try {
    body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
  } catch {
    body = {};
  }

  const orderId = body.order_id || body.orderId || body.reference || body.trackingCode;
  const eventId = body.event_id || body.eventId || body.transaction_id || body.id || `evt_${Date.now()}`;
  const amount = Number(body.amount || body.total_price || 0);
  const currency = body.currency || 'NGN';

  if (!orderId) {
    return res.status(400).json({ success: false, error: 'Missing order_id' });
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseKey) {
    console.error('[VoltEdge Payment Webhook] SUPABASE_URL or SUPABASE_ANON_KEY is not configured in .env');
    return res.status(500).json({ success: false, error: 'ServerConfigurationError' });
  }

  try {
    const supaRes = await fetch(`${supabaseUrl}/rest/v1/rpc/confirm_payment_and_deduct_stock`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': supabaseKey,
        'Authorization': `Bearer ${supabaseKey}`
      },
      body: JSON.stringify({
        p_order_id: orderId,
        p_payment_provider: 'BACHS',
        p_provider_event_id: String(eventId),
        p_amount: amount,
        p_currency: currency,
        p_raw_payload: body
      })
    });

    const result = await supaRes.json();

    if (!supaRes.ok) {
      console.error('[VoltEdge Payment Webhook] Supabase RPC error:', result);
      return res.status(500).json({ success: false, error: 'DatabaseExecutionError', details: result });
    }

    console.log(`[VoltEdge Payment Webhook] Stock confirmed and deducted for order ${orderId}:`, result);
    return res.status(200).json({
      success: true,
      message: 'Payment verified and stock deducted successfully',
      result
    });
  } catch (err) {
    console.error('[VoltEdge Payment Webhook] Internal exception:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
};
