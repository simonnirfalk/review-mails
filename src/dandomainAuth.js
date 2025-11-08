// src/dandomainAuth.js
import axios from "axios";
import qs from "qs";

const TOKEN_URL = process.env.DANDOMAIN_OAUTH_TOKEN_URL;
const CLIENT_ID = process.env.DANDOMAIN_OAUTH_CLIENT_ID;
const CLIENT_SECRET = process.env.DANDOMAIN_OAUTH_CLIENT_SECRET;

const HTTP_TIMEOUT = Number(process.env.DANDOMAIN_HTTP_TIMEOUT || 30000);

if (!TOKEN_URL || !CLIENT_ID || !CLIENT_SECRET) {
  console.error("[DandomainAuth] Manglende ENV variables");
}

/**
 * Henter OAuth-token via client_credentials
 */
export async function getAccessToken() {
  try {
    // ✅ Build POST-body
    const params = qs.stringify({
      grant_type: "client_credentials",
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
    });

    const { data } = await axios.post(
      TOKEN_URL,
      params,
      {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "User-Agent": "Smartphoneshop-ReviewMailer/1.0",
        },
        timeout: HTTP_TIMEOUT,
      }
    );

    if (!data?.access_token) {
      throw new Error("Intet access_token i OAuth respons");
    }

    return data.access_token;
  } catch (err) {
    console.error("[DandomainAuth] OAuth fejl:", err.response?.data || err.message);
    throw err;
  }
}
