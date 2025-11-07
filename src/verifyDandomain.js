import crypto from "crypto";

export function verifyDandomain(req, res, next) {
  const signature = req.headers["x-webhook-signature"];
  const token = process.env.DANDOMAIN_TOKEN;

  if (!signature || !token) {
    return res.status(401).json({ error: "Missing signature or token" });
  }

  const hmac = crypto.createHmac("sha256", token)
    .update(req.rawBody)
    .digest("base64");

  if (hmac !== signature) {
    return res.status(401).json({ error: "Invalid signature" });
  }

  next();
}
