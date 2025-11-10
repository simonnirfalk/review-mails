// src/dandomainAuth.js
import axios from "axios";

let cachedToken = null;
let tokenExpiresAt = 0;

/**
 * Fetch & cache OAuth access token from DanDomain OAuth.
 * Requires .env:
 *   DANDOMAIN_OAUTH_URL=https://oauth.api.mywebshop.io/oauth/token
 *   DANDOMAIN_CLIENT_ID=review-mails
 *   DANDOMAIN_CLIENT_SECRET=xxxxxxxxxxx
 */
export async function getDanDomainAccessToken() {
  const now = Date.now();
  if (cachedToken && now < tokenExpiresAt) return cachedToken;

  const tokenUrl     = process.env.DANDOMAIN_OAUTH_URL || "https://oauth.api.mywebshop.io/oauth/token";
  const clientId     = process.env.DANDOMAIN_CLIENT_ID;
  const clientSecret = process.env.DANDOMAIN_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error("Missing DANDOMAIN_CLIENT_ID or DANDOMAIN_CLIENT_SECRET");
  }

  const body = new URLSearchParams();
  body.append("grant_type", "client_credentials");
  body.append("client_id", clientId);
  body.append("client_secret", clientSecret);
  // docs allow scope but it's optional; keep empty:
  body.append("scope", "");

  try {
    const { data } = await axios.post(tokenUrl, body, {
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      timeout: 30000,
      // some proxies are picky about Accept:
      validateStatus: s => s < 500
    });

    if (!data?.access_token) {
      // bubble up useful details for 401/400
      const detail = typeof data === "object" ? JSON.stringify(data) : String(data);
      throw new Error(`Token response missing access_token (status ok). Raw: ${detail}`);
    }

    const ttl = (Number(data.expires_in) || 3600) - 300; // renew 5 min early
    cachedToken = data.access_token;
    tokenExpiresAt = Date.now() + Math.max(ttl, 60) * 1000;

    return cachedToken;
  } catch (err) {
    // surface 4xx nicely
    const msg = err.response?.data
      ? JSON.stringify(err.response.data)
      : err.message;
    throw new Error(`OAuth token fetch failed: ${msg}`);
  }
}

/** helper for tests */
export function _resetDanDomainTokenCache() {
  cachedToken = null;
  tokenExpiresAt = 0;
}
