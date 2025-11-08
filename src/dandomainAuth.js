// src/dandomainAuth.js
import axios from "axios";

const TOKEN_URL = process.env.DANDOMAIN_OAUTH_TOKEN_URL;
const CLIENT_ID = process.env.DANDOMAIN_OAUTH_CLIENT_ID;
const CLIENT_SECRET = process.env.DANDOMAIN_OAUTH_CLIENT_SECRET;
const HTTP_TIMEOUT = Number(process.env.DANDOMAIN_HTTP_TIMEOUT || 30000);

const { data } = await axios.post(TOKEN_URL, params.toString(), {
  headers: {
    "Content-Type": "application/x-www-form-urlencoded",
    "User-Agent": "Smartphoneshop-ReviewMailer/1.0",
  },
  timeout: HTTP_TIMEOUT,
});

let cache = { access_token: null, expires_at: 0 }; // epoch ms

function willExpireSoon() {
  return !cache.access_token || Date.now() > (cache.expires_at - 60_000); // refresh 1 min før
}

export async function getAccessToken() {
  if (!willExpireSoon()) return cache.access_token;

  if (!TOKEN_URL || !CLIENT_ID || !CLIENT_SECRET) {
    throw new Error("OAuth env mangler (TOKEN_URL/CLIENT_ID/CLIENT_SECRET)");
  }

  // DanDomain kører standard OAuth2 client_credentials
  const params = new URLSearchParams();
  params.set("grant_type", "client_credentials");
  params.set("client_id", CLIENT_ID);
  params.set("client_secret", CLIENT_SECRET);

  const { data } = await axios.post(TOKEN_URL, params.toString(), {
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    timeout: 15000,
  });

  // data: { access_token, token_type, expires_in }
  cache.access_token = data.access_token;
  cache.expires_at = Date.now() + (Number(data.expires_in || 900) * 1000);

  return cache.access_token;
}
