import { config } from "../config.js";

export function buildCrmQuotePayload({ conversation, quote }) {
  return {
    event: "cleanquo.quote_ready",
    source: "whatsapp",
    userId: conversation.userId,
    status: conversation.status,
    profile: conversation.profile,
    wizard: conversation.profile?.wizard,
    quote,
    booking: conversation.booking,
    createdAt: conversation.createdAt,
    updatedAt: conversation.updatedAt
  };
}

export async function sendCrmQuotePayload({ conversation, quote }) {
  if (!config.CRM_WEBHOOK_URL) return null;

  const payload = buildCrmQuotePayload({ conversation, quote });
  const response = await fetch(config.CRM_WEBHOOK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`CRM webhook error ${response.status}: ${body.slice(0, 500)}`);
  }

  return response.json().catch(() => ({}));
}
