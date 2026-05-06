const { supabase } = require("../config/supabase");

// Performance optimization: Cache authenticated users to avoid hitting Supabase API on every single request
const sessionCache = new Map();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

const authMiddleware = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;

    if (!token) {
      return res.status(401).json({ success: false, error: "Unauthorized", code: 401 });
    }

    // 1. Check local cache first
    const cached = sessionCache.get(token);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
      req.user = cached.user;
      return next();
    }

    // 2. Not in cache or expired -> Verify with Supabase
    // This is the part that was timing out due to network latency
    const { data: userData, error: userErr } = await supabase.auth.getUser(token);
    if (userErr || !userData?.user) {
      console.error(`[Auth] Token validation failed for ${token.substring(0, 10)}...:`, userErr?.message);
      
      // If we have an expired cache but Supabase is timed out/down, 
      // we might want to "gracefully" let them continue for a bit longer
      // But for security, we'll follow standard protocol unless it's a timeout
      if (userErr?.message?.includes("timeout") && cached) {
         req.user = cached.user;
         return next();
      }
      return res.status(401).json({ success: false, error: "Invalid token", code: 401 });
    }

    // 3. Fetch/Verify profile
    const { data: profile, error: profileErr } = await supabase
      .from("profiles")
      .select("id, full_name, role, is_active, is_blocked")
      .eq("id", userData.user.id)
      .single();

    if (profileErr || !profile || !profile.is_active) {
      return res.status(403).json({ success: false, error: "User inactive or missing profile", code: 403 });
    }

    if (profile.is_blocked) {
      return res.status(403).json({ success: false, error: "Contact OlitechHub admin for Assistance", code: 403, blocked: true });
    }

    // Update last seen (fire and forget)
    supabase.from("profiles").update({ last_seen_at: new Date().toISOString() }).eq("id", profile.id).then(()=>{});

    const userPayload = {
      id: userData.user.id,
      email: userData.user.email,
      username: userData.user.user_metadata?.username || userData.user.email,
      role: profile.role,
      full_name: profile.full_name,
      token,
    };

    // 4. Update cache
    sessionCache.set(token, { user: userPayload, timestamp: Date.now() });
    
    // Periodically clean up old cache entries
    if (sessionCache.size > 1000) {
      const now = Date.now();
      for (const [key, value] of sessionCache.entries()) {
        if (now - value.timestamp > CACHE_TTL) sessionCache.delete(key);
      }
    }

    req.user = userPayload;
    next();
  } catch (error) {
    // Handle Supabase/Networking timeout specifically
    if (error.code === 'UND_ERR_CONNECT_TIMEOUT' || error.message?.includes('timeout')) {
      return res.status(503).json({ 
        success: false, 
        error: "Security validation timeout (Supabase). Please try again in a moment.", 
        code: 503 
      });
    }
    next(error);
  }
};

module.exports = authMiddleware;
