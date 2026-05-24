import { config } from "../config.js";
import { sendText } from "../services/whatsapp.js";
import { normalizeText } from "../utils/text.js";

export async function handleWebsiteLead(payload = {}) {
  const lead = normalizeWebsiteLead(payload);

  if (!lead.phone && !lead.email) {
    throw new Error("Website lead must include phone or email");
  }

  const tasks = [];

  if (config.ADMIN_WHATSAPP_NUMBER) {
    tasks.push(sendText(config.ADMIN_WHATSAPP_NUMBER, formatAdminLeadAlert(lead)));
  }

  if (lead.phone && lead.whatsappOptIn) {
    tasks.push(sendText(lead.phone, formatLeadAcknowledgement(lead)));
  }

  await Promise.all(tasks);

  return {
    ok: true,
    routedToAdmin: Boolean(config.ADMIN_WHATSAPP_NUMBER),
    acknowledgementSent: Boolean(lead.phone && lead.whatsappOptIn),
    lead
  };
}

function normalizeWebsiteLead(payload) {
  return {
    name: normalizeText(payload.name ?? payload.fullName ?? ""),
    phone: normalizePhone(payload.phone ?? payload.whatsapp ?? payload.mobile ?? ""),
    email: normalizeText(payload.email ?? ""),
    service: normalizeText(payload.service ?? payload.serviceRequired ?? ""),
    location: normalizeText(payload.location ?? payload.suburb ?? payload.area ?? ""),
    message: normalizeText(payload.message ?? payload.notes ?? payload.description ?? ""),
    source: normalizeText(payload.source ?? "website"),
    whatsappOptIn: payload.whatsappOptIn === true || payload.whatsapp_opt_in === true,
    receivedAt: new Date().toISOString()
  };
}

function normalizePhone(value) {
  return String(value).replace(/[^\d]/g, "");
}

function formatAdminLeadAlert(lead) {
  return [
    "New website lead",
    "",
    `Name: ${lead.name || "Not supplied"}`,
    `Phone: ${lead.phone || "Not supplied"}`,
    `Email: ${lead.email || "Not supplied"}`,
    `Service: ${lead.service || "Not supplied"}`,
    `Location: ${lead.location || "Not supplied"}`,
    `Source: ${lead.source}`,
    "",
    lead.message ? `Message: ${lead.message}` : "Message: Not supplied"
  ].join("\n");
}

function formatLeadAcknowledgement(lead) {
  const name = lead.name ? ` ${lead.name}` : "";

  return [
    `Hi${name}, thanks for contacting us.`,
    "We received your cleaning request and will reply shortly with the next step."
  ].join("\n");
}
