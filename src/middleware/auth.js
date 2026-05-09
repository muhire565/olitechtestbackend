const { supabase } = require("../config/supabase");

const sessionCache = new Map();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

const authMiddleware = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization || "";
    // SSE clients (EventSource) cannot send custom headers, so they pass the
    // token as ?_token=... query param as a fallback.
    const token = authHeader.startsWith("Bearer ")
      ? authHeader.slice(7)
      : (req.query._token ? String(req.query._token) : null);

    if (!token) {
      return res.status(401).json({ success: false, error: "Unauthorized", code: 401 });
    }

    // 1. Aggressive Cache Check (Token + Profile)
    const cached = sessionCache.get(token);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
      req.user = cached.userPayload;
      return next();
    }

    // 2. Resilient Identity Verification (with Retries)
    let attempts = 3;
    let authData = null;
    let profile = null;
    let lastError = null;

    while (attempts > 0) {
      try {
        // Step A: Verify JWT with Supabase Auth
        const { data: aData, error: aErr } = await supabase.auth.getUser(token);
        if (aErr) throw aErr;
        authData = aData;

        // Step B: Fetch Profile from DB
        const { data: pData, error: pErr } = await supabase
          .from("profiles")
          .select("id, full_name, role, is_active, is_blocked, force_logout_at")
          .eq("id", authData.user.id)
          .single();
        
        if (pErr) throw pErr;
        profile = pData;

        break; // Success!

      } catch (err) {
        lastError = err;
        const isNetworkError = err.message?.includes("fetch failed") || err.message?.includes("timeout") || err.code === 'UND_ERR_CONNECT_TIMEOUT';
        
        if (isNetworkError && attempts > 1) {
          attempts--;
          console.warn(`[Auth] Connection timeout. Retrying identity check... (${attempts} left)`);
          await new Promise(r => setTimeout(r, 1000));
        } else {
          // Hard error or exhausted retries
          if (isNetworkError) {
            return res.status(503).json({ 
              success: false, 
              error: "Security check timed out (Supabase). Please refresh.", 
              code: 503 
            });
          }
          return res.status(401).json({ success: false, error: "Session invalid or profile missing", code: 401 });
        }
      }
    }

    // 3. Validation Logic (Blocked/Inactive)
    if (!profile.is_active || profile.is_blocked) {
      return res.status(403).json({ 
        success: false, 
        error: profile.is_blocked ? "Account blocked. Contact admin." : "Account inactive", 
        code: 403,
        blocked: profile.is_blocked 
      });
    }

    // 4. Token Revocation Check (force_logout_at)
    if (profile.force_logout_at) {
      const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString());
      if (payload.iat * 1000 < new Date(profile.force_logout_at).getTime() - 1000) {
        return res.status(401).json({ success: false, error: "Session revoked", code: 401 });
      }
    }

    // 5. Construct Payload and Cache results
    const userPayload = {
      id: authData.user.id,
      email: authData.user.email,
      username: authData.user.user_metadata?.username || authData.user.email,
      role: profile.role,
      full_name: profile.full_name,
      token,
    };

    sessionCache.set(token, { userPayload, timestamp: Date.now() });
    
    // Update last seen (background - no await)
    supabase.from("profiles").update({ last_seen_at: new Date().toISOString() }).eq("id", profile.id).then(()=>{});

    req.user = userPayload;
    next();
  } catch (error) {
    console.error("[Auth] Critical Middleware Error:", error);
    next(error);
  }
};

module.exports = authMiddleware;
