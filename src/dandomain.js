// dandomain.js
import axios from "axios";
import { getDanDomainAccessToken } from "./dandomainAuth.js";
import { logger } from "./logger.js";

/**
 * Dynamisk GraphQL-endpoint: tillad override via .env
 * Eksempel:
 *   DANDOMAIN_SHOP_ID=shop99794
 *   DANDOMAIN_GRAPHQL_URL=https://shop99794.mywebshop.io/api/graphql
 */
const SHOP_ID = process.env.DANDOMAIN_SHOP_ID;
const GQL_URL =
  process.env.DANDOMAIN_GRAPHQL_URL ||
  (SHOP_ID ? `https://${SHOP_ID}.mywebshop.io/api/graphql` : null);

if (!GQL_URL) {
  throw new Error("Missing DANDOMAIN_GRAPHQL_URL or DANDOMAIN_SHOP_ID");
}

/**
 * Generisk GraphQL POST-request til DanDomain
 */
export async function postGraphQL(query, variables = {}) {
  const token = await getDanDomainAccessToken();

  const res = await axios.post(
    GQL_URL,
    { query, variables },
    {
      headers: {
        "Authorization": `Bearer ${token}`,
        "Accept": "application/json",
        "Content-Type": "application/json",
      },
      timeout: 30000,
      validateStatus: (s) => s < 500,
    }
  );

  if (res.status >= 400) {
    logger.error(
      { status: res.status, data: res.data },
      "GraphQL request failed (HTTP error)"
    );
    throw new Error(`GraphQL HTTP ${res.status}`);
  }

  if (res.data.errors) {
    logger.error({ errors: res.data.errors }, "GraphQL returned errors");
    throw new Error(JSON.stringify(res.data.errors));
  }

  return res.data.data;
}

/**
 * Hent ordre via ID — bruges af server.js når webhook rammer
 */
export async function fetchOrderById(orderId) {
  const query = `
    query GetOrder($id: ID!) {
      orderById(id: $id) {
        id
        createdAt
        total
        subTotal
        isPaid

        status {
          id
        }

        customer {
          id
          businessCustomer
          billingAddress {
            firstName
            lastName
            company
            addressLine
            zipCode
            city
            country
            phoneNumber
            mobileNumber
            email
          }
          shippingAddress {
            firstName
            lastName
            company
            addressLine
            zipCode
            city
            country
            phoneNumber
            mobileNumber
            email
          }
        }

        orderLines {
          id
          productTitle
          amount
        }
      }
    }`;

  const data = await postGraphQL(query, { id: orderId });
  return data?.orderById || null;
}

/**
 * Tilføj debug routes til Express (valgfrit, men nyttigt)
 */
export function attachDandomainDebugRoutes(app) {
  app.get("/debug/oauth", async (_req, res) => {
    try {
      const token = await getDanDomainAccessToken();
      res.json({ ok: true, token: token.slice(0, 20) + "..." });
    } catch (e) {
      res.status(500).json({ ok: false, error: e?.message || String(e) });
    }
  });

  app.get("/debug/gql", async (req, res) => {
    const id = req.query.id;
    if (!id) return res.status(400).json({ ok: false, error: "Missing ?id=" });
    try {
      const order = await fetchOrderById(id);
      res.json({ ok: true, order });
    } catch (e) {
      res.status(500).json({ ok: false, error: e?.message || String(e) });
    }
  });
  
  // ⚠️ Kun til lokal fejlfinding: returnér HELE tokenet
  app.get("/debug/oauth/full", async (_req, res) => {
    try {
      const token = await getDanDomainAccessToken();
      res.json({ ok: true, token });
    } catch (e) {
      res.status(500).json({ ok: false, error: e?.message || String(e) });
    }
  });

}
