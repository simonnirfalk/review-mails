# Review-mails (Smartphoneshop.dk)

Formål: Send **én** service-mail efter X dage (default 14) med links til Google, PriceRunner og Trustpilot. Ingen marketing. Ingen Mailchimp Audience.

## Kom i gang

1) `cp .env.example .env` og udfyld værdier (Mandrill API key, links, FROM_EMAIL).
2) `npm install`
3) `npm run dev`
4) Tjek `GET /health` → `{ ok: true }`

## Webhooks (DanDomain)
- POST `/webhooks/dandomain/order-created`
- POST `/webhooks/dandomain/order-updated`

Tilføj header `x-webhook-secret: <WEBHOOK_SECRET>` hvis du vil.

## Database
SQLite-fil: `SQLITE_PATH` (default `./data/review-mails.sqlite`).
Tabeller oprettes automatisk.

## Scheduler
Kører hvert 15. minut og sender due mails. Markerede mails får `sent_at`.

## Noter
- Ingen marketingliste. Ren transaktionel udsendelse via Mandrill.
- Udsendelse stoppes, hvis ordre refunderes/annulleres (`order-updated`).
