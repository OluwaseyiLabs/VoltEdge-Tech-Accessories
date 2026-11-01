// Vercel Serverless Function: Secure Admin Authentication Proxy
// Enforces IP Rate Limiting (5 attempts / 1 min) and Account Lockout (5 failed attempts = 15 min lockout)
// Backed by PostgreSQL check_admin_lockout, record_admin_login_failure, and record_admin_login_success.

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

  // 1. IP Rate Limiting (5 requests per 60 seconds per IP by default)
  const allowed = await rateLimitMiddleware(req, res, 'admin_login');
  if (!allowed) {
    return; // 429 response already sent with Retry-After header
  }

  // 2. Parse request body
  let bodyObj = {};
  try {
    bodyObj = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
  } catch {
    bodyObj = {};
  }

  const email = (bodyObj.email || '').trim().toLowerCase();
  const password = bodyObj.password || '';

  if (!email || !password) {
    return res.status(400).json({
      success: false,
      error: 'BadRequest',
      message: 'Both email and password are required.'
    });
  }

  const supabaseUrl = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
  const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || '';

  if (!supabaseUrl || !supabaseAnonKey) {
    return res.status(500).json({
      success: false,
      error: 'ServerConfigError',
      message: 'Authentication service configuration is missing.'
    });
  }

  // 3. Check Account Lockout State via PostgreSQL check_admin_lockout RPC
  try {
    const lockoutCheckRes = await fetch(`${supabaseUrl}/rest/v1/rpc/check_admin_lockout`, {
      method: 'POST',
      headers: {
        'apikey': supabaseAnonKey,
        'Authorization': `Bearer ${supabaseAnonKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ p_email: email })
    });

    if (lockoutCheckRes.ok) {
      const lockoutData = await lockoutCheckRes.json();
      if (lockoutData && lockoutData.is_locked) {
        const remainingMinutes = Math.ceil((lockoutData.remaining_seconds || 900) / 60);
        return res.status(423).json({
          success: false,
          error: 'AccountLocked',
          message: `This account is temporarily locked due to multiple consecutive failed login attempts. Please wait ${remainingMinutes} minute(s) or click 'Forgot Password?' to reset your credentials.`,
          lockedUntil: lockoutData.locked_until,
          remainingSeconds: lockoutData.remaining_seconds,
          canResetPassword: true
        });
      }
    }
  } catch (err) {
    console.warn('[VoltEdge Login] Lockout check exception:', err.message);
  }

  // 4. Attempt authentication with Supabase GoTrue Auth
  try {
    const authRes = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: {
        'apikey': supabaseAnonKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ email, password })
    });

    const authData = await authRes.json();

    if (!authRes.ok) {
      // Authentication failed -> Record failure and increment counter
      let failureInfo = { is_locked: false, failed_attempts: 1, remaining_attempts: 4 };
      try {
        const failRes = await fetch(`${supabaseUrl}/rest/v1/rpc/record_admin_login_failure`, {
          method: 'POST',
          headers: {
            'apikey': supabaseAnonKey,
            'Authorization': `Bearer ${supabaseAnonKey}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ p_email: email, p_max_attempts: 5, p_lockout_minutes: 15 })
        });
        if (failRes.ok) {
          failureInfo = await failRes.json();
        }
      } catch (err) {
        console.warn('[VoltEdge Login] Error recording failure:', err.message);
      }

      if (failureInfo.is_locked) {
        return res.status(423).json({
          success: false,
          error: 'AccountLocked',
          message: "Account has been temporarily locked for 15 minutes due to 5 consecutive failed login attempts. You can click 'Forgot Password?' to reset your password immediately.",
          lockedUntil: failureInfo.locked_until,
          remainingSeconds: failureInfo.remaining_seconds || 900,
          canResetPassword: true
        });
      }

      return res.status(401).json({
        success: false,
        error: 'InvalidCredentials',
        message: `Invalid email or password. Attempt ${failureInfo.failed_attempts || 1} of 5 before account lockout.`,
        failedAttempts: failureInfo.failed_attempts || 1,
        remainingAttempts: failureInfo.remaining_attempts !== undefined ? failureInfo.remaining_attempts : Math.max(0, 5 - (failureInfo.failed_attempts || 1))
      });
    }

    // 5. Auth Succeeded -> Reset lockout counter
    try {
      await fetch(`${supabaseUrl}/rest/v1/rpc/record_admin_login_success`, {
        method: 'POST',
        headers: {
          'apikey': supabaseAnonKey,
          'Authorization': `Bearer ${supabaseAnonKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ p_email: email })
      });
    } catch (err) {
      console.warn('[VoltEdge Login] Error recording success:', err.message);
    }

    // 6. Verify administrator active status in admin_profiles
    const userId = authData.user ? authData.user.id : null;
    let profile = null;

    if (userId) {
      try {
        const profRes = await fetch(`${supabaseUrl}/rest/v1/admin_profiles?user_id=eq.${userId}&select=*`, {
          headers: {
            'apikey': supabaseAnonKey,
            'Authorization': `Bearer ${authData.access_token}`,
            'Accept': 'application/vnd.pgrst.object+json'
          }
        });
        if (profRes.ok) {
          profile = await profRes.json();
        }
      } catch (e) {
        console.warn('[VoltEdge Login] Error fetching admin profile:', e.message);
      }
    }

    if (profile && profile.is_active === false) {
      return res.status(403).json({
        success: false,
        error: 'AccountDeactivated',
        message: 'Your administrator account has been deactivated. Please contact the system owner.'
      });
    }

    return res.status(200).json({
      success: true,
      session: {
        access_token: authData.access_token,
        refresh_token: authData.refresh_token,
        expires_in: authData.expires_in,
        token_type: authData.token_type,
        user: authData.user
      },
      profile: profile
    });

  } catch (err) {
    console.error('[VoltEdge Login] Unexpected error:', err);
    return res.status(500).json({
      success: false,
      error: 'InternalError',
      message: 'An unexpected authentication error occurred. Please try again later.'
    });
  }
};

