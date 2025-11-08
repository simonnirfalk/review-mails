// src/dandomain.js
import axios from "axios";
import { getAccessToken } from "./dandomainAuth.js";

const GRAPHQL_URL =
  process.env.DANDOMAIN_GRAPHQL_URL ||
  `https://${process.env.SHOP_ID || "shop99794"}.mywebshop.io/api/graphql`;

const HTTP_TIMEOUT = Number(process.env.DANDOMAIN_HTTP_TIMEOUT || 30000);

/**
 * Kør et GraphQL-kald mod DanDomain med automatisk Bearer-token.
 */
export async function gqlRequest(query, variables = {}) {
  const token = await getAccessToken();

  const { data } = await axios.post(
    GRAPHQL_URL,
    { query, variables },
    {
      timeout: HTTP_TIMEOUT,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      maxRedirects: 0,
      validateStatus: (s) => s >= 200 && s < 500,
    }
  );

  if (data?.errors?.length) {
    const first = data.errors[0];
    throw new Error(`GraphQL error: ${first.message || JSON.stringify(first)}`);
  }

  return data?.data;
}

/**
 * Hent en ordre på ID
 */
export async function getOrderById(orderId) {
  const q = `
    query ($id: ID!) {
      orderById(id: $id) {
        id
        createdAt
        total(includingVAT: true)
        customer {
          email
          firstName
          lastName
        }
        status { code name }
      }
    }
  `;
  const data = await gqlRequest(q, { id: String(orderId) });
  return data?.orderById || null;
}

/**
 * Hent de seneste ordrer (til debug)
 */
export async function getRecentOrders(limit = 5) {
  const q = `
    query {
      orders {
        data {
          id
          createdAt
          customer { email firstName lastName }
        }
      }
    }
  `;
  const data = await gqlRequest(q);
  const list = data?.orders?.data || [];
  // API’et returnerer typisk nyeste først – klip til limit for en sikkerheds skyld
  return list.slice(0, limit);
}

/**
 * (Valgfrit) Debug-routes så du kan teste direkte i browser/Postman
 *
 *  GET /debug/oauth        → tester at vi kan hente token
 *  GET /debug/gql          → returnerer seneste 5 ordrer (lette felter)
 *  GET /debug/gql-verbose  → returnerer seneste 5 ordrer med rådata
 */
export function attachDandomainDebugRoutes(app) {
  app.get("/debug/oauth", async (_req, res) => {
    try {
      const token = await getAccessToken();
      res.json({ ok: true, token: token.slice(0, 16) + "…", expHint: "cached in-memory" });
    } catch (e) {
      res.status(500).json({ ok: false, stage: "oauth", error: String(e.message || e) });
    }
  });

  app.get("/debug/gql", async (_req, res) => {
    try {
      const orders = await getRecentOrders(5);
      res.json({ ok: true, count: orders.length, orders });
    } catch (e) {
      res.status(500).json({ ok: false, stage: "gql", error: String(e.message || e) });
    }
  });

  app.get("/debug/gql-verbose", async (_req, res) => {
    try {
      const orders = await getRecentOrders(5);
      const hydrated = [];
      for (const o of orders) {
        hydrated.push(await getOrderById(o.id));
      }
      res.json({ ok: true, count: hydrated.length, orders: hydrated });
    } catch (e) {
      res.status(500).json({ ok: false, stage: "gql-verbose", error: String(e.message || e) });
    }
  });
}
