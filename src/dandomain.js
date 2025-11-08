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

  app.get("/debug/gql-verbose", async (_req, res) => {
    try {
      const token = await getAccessToken();
      const { data } = await axios.post(
        GQL_URL,
        { query: "query{ orders(page:1,pageSize:1){ data{ id } } }" },
        { headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` } }
      );
      res.json({ ok: true, tokenPreview: token?.slice(0, 12) + "…", data });
    } catch (e) {
      res.status(500).json({ ok: false, error: e?.response?.data || e.message || String(e) });
    }
  });
}
