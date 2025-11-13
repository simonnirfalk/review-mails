// generate-hmac.js
import "dotenv/config";
import crypto from "crypto";

const secret = process.env.DANDOMAIN_TOKEN;
if (!secret) {
  console.error("❌ Missing DANDOMAIN_TOKEN in .env");
  process.exit(1);
}

const body = JSON.stringify({ id: "13123" });

const signature = crypto
  .createHmac("sha256", secret)
  .update(body, "utf8")
  .digest("base64");

console.log("DANDOMAIN_TOKEN:", secret);
console.log("Body:", body);
console.log("Signature (base64):", signature);
