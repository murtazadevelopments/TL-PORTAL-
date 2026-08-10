const {
  verifyCredentials,
  createContextClient,
  createAdminClient,
} = require('@supabase/server/core');

/**
 * Pull Bearer token + apikey from an Express request for @supabase/server.
 */
function credentialsFromExpress(req) {
  const authHeader = req.headers.authorization;
  const token =
    typeof authHeader === 'string' && authHeader.startsWith('Bearer ')
      ? authHeader.slice(7)
      : null;
  const apikeyHeader = req.headers.apikey;
  const apikey = Array.isArray(apikeyHeader)
    ? apikeyHeader[0]
    : (apikeyHeader ?? null);

  return { token, apikey };
}

/**
 * Express middleware factory. On success, attaches:
 *   req.supabaseContext = { supabase, supabaseAdmin, userClaims, jwtClaims, authMode, authKeyName?, token? }
 */
function requireSupabaseAuth(auth = 'user') {
  return async (req, res, next) => {
    try {
      const credentials = credentialsFromExpress(req);
      const { data: authResult, error } = await verifyCredentials(credentials, {
        auth,
      });

      if (error) {
        return res.status(error.status).json({
          message: error.message,
          code: error.code,
        });
      }

      const supabase = createContextClient({
        auth: {
          token: authResult.token,
          keyName: authResult.keyName,
        },
      });

      let supabaseAdmin;
      req.supabaseContext = {
        supabase,
        get supabaseAdmin() {
          if (!supabaseAdmin) supabaseAdmin = createAdminClient();
          return supabaseAdmin;
        },
        userClaims: authResult.userClaims,
        jwtClaims: authResult.jwtClaims,
        authMode: authResult.authMode,
        authKeyName: authResult.keyName,
        token: authResult.token,
      };

      return next();
    } catch (err) {
      console.error('Supabase auth middleware error:', err);
      return res.status(500).json({
        message: err.message || 'Supabase configuration error',
      });
    }
  };
}

module.exports = {
  credentialsFromExpress,
  requireSupabaseAuth,
  createContextClient,
  createAdminClient,
};
