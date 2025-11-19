// scripts/rebuild-queue.mjs
//
// Genopbyg review_queue ud fra ordrer i DanDomain
// Brug:  node scripts/rebuild-queue.mjs [dageTilbage]
// Eksempel: node scripts/rebuild-queue.mjs 10

import "dotenv/config";
import axios from "axios";
import { getDanDomainAccessToken } from "./dandomainAuth.js";
import { db, insertJob } from "../db.js";

// Hvor langt tilbage vi kigger (default 10 dage)
const DAYS_BACK = Number(process.argv[2] || 10);

// KUN disse statusser må få review-mails
// 3 = Gennemført ordre
const ALLOWED_STATUS_IDS = new Set([3]);

// Hvor mange dage efter oprettelse mailen skal sendes
const DELAY_DAYS = Number(process.env.REVIEW_DELAY_DAYS || 5);

// Lille helper til at lave ISO-datoer
function addDays(iso, days) {
  const d = new Date(iso);
  d.setDate(d.getDate() + days);
  return d.toISOString();
}

// Tjek om ordre allerede har et job i køen
const hasJobStmt = db.prepare(
  "SELECT COUNT(*) AS c FROM review_queue WHERE order_id = ?"
);

async function fetchOrdersSince(sinceIso) {
  const url = process.env.DANDOMAIN_GRAPHQL_URL;
  if (!url) throw new Error("Missing DANDOMAIN_GRAPHQL_URL");

  const token = await getDanDomainAccessToken();

  const query = `
    query RebuildQueue($limit: Int!, $page: Int!, $from: String!) {
      orders(
        pagination: { limit: $limit, page: $page }
        order: { field: id, direction: DESC }
        search: [
          { field: createdAt, comparator: GREATER_THAN, value: $from }
        ]
      ) {
        data {
          id
          createdAt
          status { id }
          customer {
            billingAddress {
              email
              firstName
              lastName
            }
            shippingAddress {
              email
              firstName
              lastName
            }
          }
        }
      }
    }
  `;

  const all = [];
  const limit = 50;
  let page = 1;

  while (true) {
    const { data } = await axios.post(
      url,
      {
        query,
        variables: { limit, page, from: sinceIso },
      },
      {
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        timeout: 15000,
        validateStatus: (s) => s < 500,
      }
    );

    if (data.errors) {
      console.error("GraphQL errors:", JSON.stringify(data.errors, null, 2));
      throw new Error("GraphQL returned errors");
    }

    const items = data?.data?.orders?.data || [];
    if (!items.length) break;

    all.push(...items);
    if (items.length < limit) break;
    page += 1;
  }

  return all;
}

async function main() {
  const now = new Date();
  const since = new Date(now.getTime() - DAYS_BACK * 86400000);
  const sinceIso = since.toISOString();

  console.log(
    `Genopbygger queue for ordrer siden ${sinceIso} (sidste ${DAYS_BACK} dage) …`
  );

  const orders = await fetchOrdersSince(sinceIso);
  console.log(`Hentede ${orders.length} ordrer fra DanDomain`);

  let inserted = 0;
  let skippedExisting = 0;
  let skippedNoMail = 0;
  let skippedStatus = 0;

  for (const o of orders) {
    const orderId = String(o.id);
    const statusId = Number(o?.status?.id || 0);

    // Kun Gennemført ordre
    if (!ALLOWED_STATUS_IDS.has(statusId)) {
      skippedStatus++;
      continue;
    }

    const billing = o?.customer?.billingAddress || {};
    const shipping = o?.customer?.shippingAddress || {};

    const email = (billing.email || shipping.email || "").trim();
    const name = [billing.firstName, billing.lastName]
      .filter(Boolean)
      .join(" ")
      .trim();

    if (!email) {
      skippedNoMail++;
      continue;
    }

    const already = hasJobStmt.get(orderId).c;
    if (already) {
      skippedExisting++;
      continue;
    }

    const createdISO = new Date(o.createdAt || Date.now()).toISOString();
    const sendAfter = addDays(createdISO, DELAY_DAYS);

    insertJob.run({
      order_id: orderId,
      email,
      name,
      created_at: createdISO,
      send_after: sendAfter,
    });

    inserted++;
  }

  console.log("Færdig med genopbygning:");
  console.log("  Nye jobs oprettet            :", inserted);
  console.log("  Skippet (allerede job)       :", skippedExisting);
  console.log("  Skippet (ingen e-mail)       :", skippedNoMail);
  console.log("  Skippet (status != 3)        :", skippedStatus);
}

main()
  .then(() => {
    console.log("Done.");
    process.exit(0);
  })
  .catch((err) => {
    console.error("Fejl i rebuild-queue:", err?.message || err);
    process.exit(1);
  });
