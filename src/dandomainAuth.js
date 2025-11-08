// src/dandomainAuth.js
import axios from "axios";

const TOKEN_URL =
  process.env.DANDOMAIN_OAUTH_TOKEN_URL ||
  "https://oauth.api.mywebshop.io/oauth/token";

const CLIENT_ID = process.env.DANDOMAIN_CLIENT_ID;
const CLIENT_SECRET = process.env.DANDOMAIN_CLIENT_SECRET;
const HTTP_TIMEOUT = Number(process.env.DANDOMAIN_HTTP_TIMEOUT || 30000);

// Simpel in-memory token-cache
let cached = { token: null, exp: 0 };

/**
 * Hent (eller forny) access token via client_credentials.
 * Returnerer en gyldig Bearer token-streng.
 */
export async function getAccessToken() {
  const now = Date.now();
  if (cached.token && now < cached.exp - 30_000) {
    // brug cachet token til 30s før udløb
    return cached.token;
  }

  if (!CLIENT_ID || !CLIENT_SECRET) {
    throw new Error("DANDOMAIN_CLIENT_ID / DANDOMAIN_CLIENT_SECRET mangler i .env");
  }

  // DanDomain accepterer JSON payload jf. docs
  const payload = {
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    grant_type: "client_credentials",
  };

  const { data } = await axios.post(TOKEN_URL, payload, {
    timeout: HTTP_TIMEOUT,
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    // undgå evt. 302/HTML i mellemled
    maxRedirects: 0,
    validateStatus: (s) => s >= 200 && s < 400,
  });

  if (!data?.access_token) {
    throw new Error(
      `OAuth: mangler access_token (status OK men uventet svar): ${JSON.stringify(
        data
      ).slice(0, 500)}`
    );
  }

  const ttlMs = (Number(data.expires_in || 86400) - 30) * 1000; // 24h minus 30s
  cached = {
    token: data.access_token,
    exp: Date.now() + ttlMs,
  };

  return cached.token;
}
