import crypto from "node:crypto";
import { config } from "../config.js";
import { sendInteractiveButtons, sendText } from "./whatsapp.js";
import { currency } from "../utils/text.js";

export function signAdminPayload(payload) {
  return crypto
    .createHmac("sha256", config.ADMIN_APPROVAL_SECRET)
    .update(JSON.stringify(payload))
    .digest("hex");
}

export function verifyAdminSignature(payload, signature) {
  const expected = signAdminPayload(payload);
  if (!signature || signature.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature ?? ""));
}

export async function notifyAdminQuote({ conversation, quote }) {
  const summary = formatQuoteSummary(conversation, quote);
  const payload = {
    type: "quote_approval_requested",
    userId: conversation.userId,
    summary,
    profile: conversation.profile,
    quote
  };

  await notifyAdminChannels([
    sendAdminWhatsApp(summary, conversation.userId),
    postAdminWebhook(payload)
  ]);
}

export async function notifyAdminPop({ conversation, media }) {
  const message = [
    "POP received for verification.",
    "",
    `Client: ${conversation.userId}`,
    `Reference: ${conversation.booking?.paymentReference}`,
    `Quoted amount: ${currency(conversation.quote.total, conversation.quote.currency)}`,
    `Deposit expected: ${currency(conversation.quote.depositAmount, conversation.quote.currency)}`,
    `File type: ${media.mimeType}`,
    `WhatsApp media ID: ${media.mediaId}`,
    "",
    "Please verify bank clearance before marking this booking as final."
  ].join("\n");

  await notifyAdminChannels([
    config.ADMIN_WHATSAPP_NUMBER ? sendText(config.ADMIN_WHATSAPP_NUMBER, message) : null,
    postAdminWebhook({
      type: "pop_received",
      userId: conversation.userId,
      media,
      booking: conversation.booking,
      quote: conversation.quote
    })
  ]);
}

async function notifyAdminChannels(tasks) {
  const results = await Promise.allSettled(tasks);
  for (const result of results) {
    if (result.status === "rejected") {
      console.warn("Admin notification failed:", result.reason?.message ?? result.reason);
    }
  }
}

async function sendAdminWhatsApp(summary, userId) {
  if (!config.ADMIN_WHATSAPP_NUMBER) return null;

  return sendInteractiveButtons(config.ADMIN_WHATSAPP_NUMBER, summary, [
    { id: `approve_quote:${userId}`, title: "Approve Quote" },
    { id: `modify_quote:${userId}`, title: "Modify Quote" }
  ]);
}

async function postAdminWebhook(payload) {
  if (!config.ADMIN_WEBHOOK_URL) return null;

  const signature = signAdminPayload(payload);
  const response = await fetch(config.ADMIN_WEBHOOK_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Admin-Signature": signature
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Admin webhook error ${response.status}: ${body}`);
  }

  return response.json().catch(() => ({}));
}

function formatQuoteSummary(conversation, quote) {
  const profile = conversation.profile;
  const addOns = quote.addOns.length
    ? quote.addOns.map((item) => `${item.name}: ${currency(item.price, quote.currency)}`).join(", ")
    : "None";

  return [
    "Quote Summary",
    "",
    `Client WhatsApp: ${conversation.userId}`,
    `Service: ${profile.serviceRequired}`,
    `Property: ${profile.propertySize}`,
    `Add-ons: ${profile.addOns || "None"} (${addOns})`,
    `Location: ${profile.location}`,
    "",
    `Estimated total: ${currency(quote.total, quote.currency)}`,
    `Required deposit: ${currency(quote.depositAmount, quote.currency)}`,
    "",
    "Approve the quote or submit a modified price from your admin endpoint."
  ].join("\n");
}
