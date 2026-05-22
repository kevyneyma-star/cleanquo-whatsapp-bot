# Cleaning WhatsApp Bot Backend

Backend logic for a WhatsApp business automation bot that qualifies cleaning leads, calculates draft quotes, routes quotes for admin approval, handles booking slot selection, requests a 50% deposit, and accepts Proof of Payment files.

## What It Does

- Receives WhatsApp Cloud API webhooks at `POST /webhooks/whatsapp`
- Verifies the Meta webhook challenge at `GET /webhooks/whatsapp`
- Maintains per-user conversation state in `.data/conversations.json`
- Asks one qualification question at a time
- Calculates an estimated quote using editable pricing placeholders
- Sends the quote summary to the admin before the customer sees it
- Lets the admin approve by WhatsApp button or via HTTP endpoint
- Sends selectable booking slots to the customer
- Requests 50% deposit with banking details/payment link
- Accepts POP files only as `image/jpeg`, `image/png`, or `application/pdf`
- Notifies the admin when POP is received

## Quick Start

```bash
cp .env.example .env
node src/server.js
```

Open:

```text
http://localhost:3000/health
```

Run the workflow smoke test:

```bash
node src/smoke-test.js
```

The app runs in WhatsApp dry-run mode until `WHATSAPP_ACCESS_TOKEN` and `WHATSAPP_PHONE_NUMBER_ID` are set.
There are no runtime npm dependencies.

## Required Environment

Copy `.env.example` to `.env` and configure:

- `WHATSAPP_PROVIDER`: use `meta` for Meta Cloud API or `greenapi` for GreenAPI.
- `WHATSAPP_VERIFY_TOKEN`: the webhook verification token you enter in Meta.
- `WHATSAPP_ACCESS_TOKEN`: WhatsApp Cloud API access token.
- `WHATSAPP_PHONE_NUMBER_ID`: phone number ID from Meta.
- `ADMIN_WHATSAPP_NUMBER`: owner/admin number in international format without `+`.
- `ADMIN_APPROVAL_SECRET`: shared secret for admin HTTP endpoints.
- Payment values: bank name, account name, account number, branch code, reference prefix.
- `PUBLIC_BASE_URL`: deployed HTTPS URL.

## GreenAPI Setup

Set:

```text
WHATSAPP_PROVIDER=greenapi
GREEN_API_ID_INSTANCE=your-instance-id
GREEN_API_TOKEN_INSTANCE=your-instance-token
GREEN_API_WEBHOOK_TOKEN=optional-shared-secret
PUBLIC_BASE_URL=https://your-domain.example
```

GreenAPI webhook URL:

```text
https://your-domain.example/webhooks/greenapi
```

After the backend is deployed, configure the instance from the backend:

```bash
curl -X POST "https://your-domain.example/admin/greenapi/configure" \
  -H "x-admin-secret: your-secret"
```

This calls GreenAPI `setSettings` with `incomingWebhook=yes` and points it at `/webhooks/greenapi`.

## OpenAI / ChatGPT Setup

Set:

```text
OPENAI_ENABLED=true
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-5.4-mini
```

The deterministic quote, booking, approval, and POP state machine remains in code. OpenAI is used only for concise customer question handling when the user sends a free-form question instead of accepting the quote.

## Meta WhatsApp Setup

1. Deploy this service to an HTTPS host.
2. In Meta Developer Dashboard, set the callback URL to:

```text
https://your-domain.example/webhooks/whatsapp
```

3. Use the same value for `WHATSAPP_VERIFY_TOKEN` in Meta and `.env`.
4. Subscribe the app to WhatsApp message webhooks.
5. Add `WHATSAPP_ACCESS_TOKEN` and `WHATSAPP_PHONE_NUMBER_ID`.

## Admin Approval

When a quote is ready, the admin receives a quote summary with:

- `Approve Quote`
- `Modify Quote`

The admin can also approve or modify with HTTP:

```bash
curl -X POST "https://your-domain.example/admin/quotes/27821234567/approve" \
  -H "Content-Type: application/json" \
  -H "x-admin-secret: your-secret" \
  -d "{\"modifiedTotal\":1450}"
```

Omit `modifiedTotal` to approve the calculated quote.

## Pricing Logic

Edit `src/services/quote-engine.js`.

Current placeholders:

- Base price by service type
- Multiplier by bedrooms/bathrooms or square meterage
- Add-on prices for carpet, windows, upholstery, oven, and fridge
- 50% deposit calculation

Replace these with your real pricing matrix once finalized.

## Calendar Logic

Edit `src/services/calendar.js`.

Current implementation returns placeholder business-day slots and creates an in-memory hold object. Replace it with:

- Google Calendar free/busy checks
- Calendly availability
- A custom admin scheduling API
- Manual admin slot approval

## POP Handling

The webhook isolates WhatsApp media IDs during the deposit stage. Accepted MIME types:

- `image/jpeg`
- `image/png`
- `application/pdf`

For production storage, add a media download step using the WhatsApp media endpoint, then store the file in S3, Google Cloud Storage, or another private bucket. Keep the WhatsApp media ID in the booking record for traceability.

## Deployment

Docker build:

```bash
docker build -t cleaning-whatsapp-bot .
docker run --env-file .env -p 3000:3000 cleaning-whatsapp-bot
```

Any HTTPS Node host works, including Render, Railway, Fly.io, Azure App Service, or a VPS behind Nginx.

Production recommendations:

- Replace the file store with Redis or Postgres.
- Add request signature validation if your webhook provider supports it.
- Store POP files in private object storage.
- Add structured logging and alerting.
- Use permanent or refreshed Meta access tokens.
- Add calendar integration before accepting live bookings.
