const { createClient } = require("@supabase/supabase-js");

const supabaseUrl = (process.env.SUPABASE_URL || "").trim();
const serviceRoleKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();

if (!supabaseUrl || !serviceRoleKey) {
  throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
}

const authClientOptions = {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
  },
};

// Service-role client used for ALL database access (bypasses RLS).
// IMPORTANT: never call signInWithPassword/refreshSession/verifyOtp on this client.
// Even with persistSession:false, supabase-js keeps the resulting user
// session in memory and then sends the user's JWT (instead of the service
// role key) as the Authorization header on every subsequent request, which
// re-enables RLS and breaks inserts (e.g. credit_sales).
const supabase = createClient(supabaseUrl, serviceRoleKey, authClientOptions);

/**
 * Fresh auth client for one login/refresh/password-check.
 * Do NOT call auth.signOut() after issuing tokens to a browser/desktop client —
 * on this Supabase project even scope:"local" deletes the server session and
 * makes the refresh token unusable ("Refresh Token Not Found").
 */
const createAuthClient = () => createClient(supabaseUrl, serviceRoleKey, authClientOptions);

// Kept for any legacy imports; prefer createAuthClient() for user credential flows.
const supabaseAuth = createAuthClient();

module.exports = { supabase, supabaseAuth, createAuthClient };
