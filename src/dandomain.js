// src/dandomain.js
import axios from "axios";
import { attachDandomainDebugRoutes } from "./dandomain.js";

// ───────────────────────────────────────────────────────────────────────────────
// ENV
// ───────────────────────────────────────────────────────────────────────────────
const GQL_URL   = (process.env.DANDOMAIN_GRAPHQL_URL || "").trim();
const GQL_TOKEN = (process.env.DANDOMAIN_GRAPHQL_TOKEN || "").trim();
// Hvis du vil tvinge et bestemt header-navn kan du sætte denne (fx "X-Shop-Token" eller "Authorization")
// Ellers lader vi den stå og auto-falder ved 401.
const HDR_ENV   = (process.env.DANDOMAIN_GRAPHQL_HEADER || "X-Shop-Token").trim();

if (!GQL_URL)  throw new Error("DANDOMAIN_GRAPHQL_URL mangler");
if (!GQL_TOKEN) console.warn("[dandomain] ⚠️ DANDOMAIN_GRAPHQL_TOKEN mangler – GraphQL-kald vil fejle");

// Felter fra dit schema (kan justeres hvis dine feltnavne afviger)
const F_CREATED   = "createdAt";
const F_STATUS    = "status";      // typisk objekt med { id, name }
const F_FIRSTNAME = "firstName";
const F_LASTNAME  = "lastName";

// ───────────────────────────────────────────────────────────────────────────────
function buildHeaders(headerName) {
  const base = { "Content-Type": "application/json" };
  if (!GQL_TOKEN) return base;

  if (headerName.toLowerCase() === "authorization") {
    return { ...base, Authorization: `Bearer ${GQL_TOKEN}` };
  }
  return { ...base, [headerName]: GQL_TOKEN };
}

// Kører request med valgt header; ved 401 prøver vi alternativ header én gang
async function gqlRequest({ query, variables }) {
  const primaryHdr = HDR_ENV || "X-Shop-Token";
  const altHdr = primaryHdr.toLowerCase() === "authorization" ? "X-Shop-Token" : "Authorization";

  try {
    return await axios.post(
      GQL_URL,
      { query, variables },
      { headers: buildHeaders(primaryHdr), timeout: 20000 }
    );
  } catch (e) {
    const status = e?.response?.status;
    if (status === 401) {
      // Prøv alternativt header-format
      return await axios.post(
        GQL_URL,
        { query, variables },
        { headers: buildHeaders(altHdr), timeout: 20000 }
      );
    }
    throw e;
  }
}

// ───────────────────────────────────────────────────────────────────────────────
// PUBLIC API
// ───────────────────────────────────────────────────────────────────────────────

/**
 * Hent seneste ordrer (simpel pagination). Vi filtrerer/mapper selv i app’en.
 * @param {{page?: number, pageSize?: number}} opts
 * @returns {Promise<Array<{id:string, createdAt:string, customer?:{email?:string, firstName?:string, lastName?:string}, status?:{id?:string, name?:string}}>>}
 */
export async function fetchLatestOrders({ page = 1, pageSize = 25 } = {}) {
  const query = `
    query LatestOrders($page:Int,$pageSize:Int){
      orders(page:$page,pageSize:$pageSize){
        data{
          id
          ${F_CREATED}
          customer{ email ${F_FIRSTNAME} ${F_LASTNAME} }
          ${F_STATUS}{ id name }
        }
      }
    }
  `;
  const variables = { page, pageSize };
  const res = await gqlRequest({ query, variables });
  return res.data?.data?.orders?.data || [];
}

/**
 * Hent én ordre via ID (hvis du kender ID'et).
 * @param {string|number} id
 */
export async function fetchOrderById(id) {
  const query = `
    query OrderById($id:ID!){
      orderById(id:$id){
        id
        ${F_CREATED}
        customer{ email ${F_FIRSTNAME} ${F_LASTNAME} }
        ${F_STATUS}{ id name }
      }
    }
  `;
  const res = await gqlRequest({ query, variables: { id: String(id) } });
  return res.data?.data?.orderById || null;
}

// ───────────────────────────────────────────────────────────────────────────────
// DEBUG-ROUTES (optionelle)
// ───────────────────────────────────────────────────────────────────────────────

export function attachDandomainDebugRoutes(app) {
  app.get("/debug/gql", async (_req, res) => {
    try {
      const list = await fetchLatestOrders({ page: 1, pageSize: 5 });
      res.json({
        ok: true,
        count: list.length,
        sample: list.slice(0, 2),
      });
    } catch (e) {
      // Vis enten GraphQL-fejl (fra DD) eller generel fejl
      const payload = e?.response?.data || e?.message || String(e);
      res.status(500).json({ ok: false, error: payload });
    }
  });
}
