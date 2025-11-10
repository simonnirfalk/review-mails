// src/dandomain.js
import axios from "axios";
import { getDanDomainAccessToken } from "./dandomainAuth.js";

const SHOP_ID = process.env.DANDOMAIN_SHOP_ID; // e.g. "shop99794"
const GQL_URL = `https://${SHOP_ID}.mywebshop.io/api/graphql`;

/**
 * Fetch order by ID using DanDomain GraphQL.
 * @param {string} orderId
 */
export async function fetchOrderById(orderId) {
  const token = await getDanDomainAccessToken();

  const query = `
    query GetOrder($id: ID!) {
      orderById(id: $id) {
        id
        createdAt
        total(includingVAT: true)
        customer { email firstName lastName }
        orderLines {
          id
          productTitle
          articleNumber
          supplierNumber
          amount
          price(includingVAT: true)
        }
      }
    }
  `;

  const variables = { id: orderId };

  const { data } = await axios.post(
    GQL_URL,
    { query, variables },
    {
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`
      },
      timeout: 30000,
      validateStatus: s => s < 500
    }
  );

  if (data?.errors) {
    throw new Error("GraphQL errors: " + JSON.stringify(data.errors));
  }
  return data?.data?.orderById || null;
}

/**
 * (Optional) Attach debug routes.
 * GET /debug/oauth  → attempts token fetch (no token returned, only status)
 * GET /debug/gql?id=123  → tries a real order query and returns JSON
 */
export function attachDandomainDebugRoutes(app) {
  app.get("/debug/oauth", async (req, res) => {
    try {
      await getDanDomainAccessToken();
      res.json({ ok: true });
    } catch (e) {
      res.json({ ok: false, stage: "oauth", error: String(e.message || e) });
    }
  });

  app.get("/debug/gql", async (req, res) => {
    try {
      const id = req.query.id || "PM-TEST-1001";
      const order = await fetchOrderById(id);
      res.json({ ok: true, url: GQL_URL, id, order });
    } catch (e) {
      res.json({ ok: false, stage: "gql", error: String(e.message || e) });
    }
  });
}
