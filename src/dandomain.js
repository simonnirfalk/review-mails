// src/dandomain.js
import axios from "axios";
import { getAccessToken } from "./dandomainAuth.js";

const GQL_URL = (process.env.DANDOMAIN_GRAPHQL_URL || "").trim();
if (!GQL_URL) throw new Error("DANDOMAIN_GRAPHQL_URL mangler");

async function gqlRequest({ query, variables }) {
  const accessToken = await getAccessToken();
  return axios.post(
    GQL_URL,
    { query, variables },
    {
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      timeout: 20000,
    }
  );
}

export async function fetchLatestOrders({ page = 1, pageSize = 25 } = {}) {
  const query = `
    query LatestOrders($page:Int,$pageSize:Int){
      orders(page:$page,pageSize:$pageSize){
        data{
          id
          createdAt
          customer{ email firstName lastName }
          status{ id name }
        }
      }
    }
  `;
  const { data } = await gqlRequest({ query, variables: { page, pageSize } });
  return data?.data?.orders?.data || [];
}

export async function fetchOrderById(id) {
  const query = `
    query OrderById($id:ID!){
      orderById(id:$id){
        id
        createdAt
        customer{ email firstName lastName }
        status{ id name }
      }
    }
  `;
  const { data } = await gqlRequest({ query, variables: { id: String(id) } });
  return data?.data?.orderById || null;
}

// Debug routes
export function attachDandomainDebugRoutes(app) {
  app.get("/debug/gql", async (_req, res) => {
    try {
      const list = await fetchLatestOrders({ page: 1, pageSize: 5 });
      res.json({ ok: true, count: list.length, sample: list.slice(0, 2) });
    } catch (e) {
      res.status(500).json({ ok: false, error: e?.response?.data || e.message || String(e) });
    }
  });

    app.get("/debug/oauth", async (_req, res) => {
    try {
      const started = Date.now();
      const token = await getAccessToken();
      const took = Date.now() - started;
      res.json({ ok: true, tookMs: took, tokenPreview: token?.slice(0, 12) + "…" });
    } catch (e) {
      res.status(500).json({
        ok: false,
        stage: "oauth",
        error: e?.response?.data || e.message || String(e),
      });
    }
  });

  app.get("/debug/gql-verbose", async (_req, res) => {
    try {
      const t0 = Date.now();
      const token = await getAccessToken();
      const t1 = Date.now();
      const { data } = await axios.post(
        process.env.DANDOMAIN_GRAPHQL_URL,
        { query: "query{ orders(page:1,pageSize:1){ data{ id createdAt } } }" },
        {
          headers: {
            "Content-Type": "application/json",
            "User-Agent": "Smartphoneshop-ReviewMailer/1.0",
            Authorization: `Bearer ${token}`,
          },
          timeout: Number(process.env.DANDOMAIN_HTTP_TIMEOUT || 30000),
        }
      );
      const t2 = Date.now();
      res.json({
        ok: true,
        oauthMs: t1 - t0,
        graphqlMs: t2 - t1,
        sample: data?.data?.orders?.data || [],
      });
    } catch (e) {
      res.status(500).json({
        ok: false,
        stage: "graphql",
        error: e?.response?.data || e.message || String(e),
      });
    }
  });
}
