// dandomainAuth.js
import axios from "axios";
import { logger } from "./logger.js";

let cachedToken = null;
let tokenExpiresAt = 0;

function tokenTTL(expires_in) {
  const ttl = (Number(expires_in) || 86400) - 300; // 24t minus 5 min buffer
  return Date.now() + ttl * 1000;
}

async function requestTokenViaForm(tokenUrl, clientId, clientSecret) {
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: clientId,
    client_secret: clientSecret,
    scope: "", // DanDomain forventer tom scope
  });

  const { data } = await axios.post(tokenUrl, body.toString(), {
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    timeout: 10000,
    validateStatus: (s) => s < 500,
  });

  return data;
}

async function requestTokenViaBasic(tokenUrl, clientId, clientSecret) {
  const pair = Buffer.from(`${clientId}:${clientSecret}`, "utf8").toString("base64");
  const { data } = await axios.post(
    tokenUrl,
    new URLSearchParams({ grant_type: "client_credentials" }).toString(),
    {
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${pair}`,
      },
      timeout: 10000,
      validateStatus: (s) => s < 500,
    }
  );
  return data;
}

/**
 * Hent (og cache) DanDomain OAuth2 access token.
 * Prøver først form-body. Hvis svaret indeholder invalid_client,
 * prøver vi Basic Auth-varianten automatisk.
 */
export async function getDanDomainAccessToken() {
  const now = Date.now();
  if (cachedToken && now < tokenExpiresAt - 60_000) return cachedToken;

  const shopId = process.env.DANDOMAIN_SHOP_ID;
  const tokenUrl =
    process.env.DANDOMAIN_OAUTH_URL ||
    (shopId ? `https://${shopId}.mywebshop.io/auth/oauth/token` : null);
  const clientId = process.env.DANDOMAIN_CLIENT_ID;
  const clientSecret = process.env.DANDOMAIN_CLIENT_SECRET;

  if (!tokenUrl) throw new Error("Missing DANDOMAIN_OAUTH_URL or DANDOMAIN_SHOP_ID");
  if (!clientId || !clientSecret)
    throw new Error("Missing DANDOMAIN_CLIENT_ID or DANDOMAIN_CLIENT_SECRET");

  try {
    // 1) Prøv form body
    let data = await requestTokenViaForm(tokenUrl, clientId, clientSecret);

    // Hvis fejl i payload, tjek om det er invalid_client og prøv Basic Auth
    if (!data?.access_token) {
      const raw = JSON.stringify(data);
      if (/invalid_client/i.test(raw)) {
        logger.warn({ tokenUrl }, "Form grant returned invalid_client — falling back to Basic Auth");
        data = await requestTokenViaBasic(tokenUrl, clientId, clientSecret);
      }
    }

    if (!data?.access_token) {
      throw new Error(`Token response invalid: ${JSON.stringify(data)}`);
    }

    cachedToken = data.access_token;
    tokenExpiresAt = tokenTTL(data.expires_in);
    logger.info({ tokenUrl }, "Fetched DanDomain access token");
    return cachedToken;
  } catch (err) {
    logger.error(
      { err: err?.response?.data || err?.message || String(err) },
      "DanDomain token request failed"
    );
    throw err;
  }
}

/** Force refresh (debug) */
export async function refreshTokenNow() {
  cachedToken = null;
  tokenExpiresAt = 0;
  return getDanDomainAccessToken();
}
