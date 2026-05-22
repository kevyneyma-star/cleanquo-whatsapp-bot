import { config } from "../config.js";
import { approveQuoteForCustomer, handleInboundMessage } from "../conversation-flow.js";
import { mapGreenApiWebhookToMessage } from "../services/greenapi.js";
import { sendText } from "../services/whatsapp.js";

export function verifyWebhookChallenge(query) {
  const mode = query["hub.mode"];
  const token = query["hub.verify_token"];
  const challenge = query["hub.challenge"];

  if (mode === "subscribe" && token === config.WHATSAPP_VERIFY_TOKEN) {
    return challenge;
  }

  return null;
}

export async function handleWhatsAppWebhook(payload) {
  const entries = payload?.entry ?? [];

  for (const entry of entries) {
    for (const change of entry.changes ?? []) {
      const value = change.value;
      const messages = value?.messages ?? [];

      for (const message of messages) {
        if (isAdminAction(message)) {
          await handleAdminAction(message);
          continue;
        }

        await handleInboundMessage(message);
      }
    }
  }
}

export async function handleGreenApiWebhook(payload, requestToken) {
  if (config.GREEN_API_WEBHOOK_TOKEN && !isValidGreenApiToken(requestToken)) {
    throw new Error("Invalid GreenAPI webhook token");
  }

  const message = mapGreenApiWebhookToMessage(payload);
  if (!message) return;

  if (message.unsupportedType) {
    await sendText(
      message.from,
      "Thanks. I can process text messages and POP files as PDF, JPG, or PNG. Please resend in one of those formats."
    );
    return;
  }

  await handleInboundMessage(message);
}

function isValidGreenApiToken(requestToken = "") {
  const expected = config.GREEN_API_WEBHOOK_TOKEN;
  return (
    requestToken === expected ||
    requestToken === `Bearer ${expected}` ||
    requestToken === `Basic ${expected}`
  );
}

function isAdminAction(message) {
  if (!config.ADMIN_WHATSAPP_NUMBER) return false;
  return message.from === config.ADMIN_WHATSAPP_NUMBER && readAdminCommand(message);
}

async function handleAdminAction(message) {
  const command = readAdminCommand(message);

  if (command.type === "approve") {
    await approveQuoteForCustomer({ userId: command.userId });
    await sendText(message.from, `Approved and sent quote to ${command.userId}.`);
    return;
  }

  if (command.type === "modify") {
    await sendText(
      message.from,
      `To modify, send: MODIFY ${command.userId} amount\nExample: MODIFY ${command.userId} 1450`
    );
    return;
  }

  if (command.type === "modify_with_amount") {
    await approveQuoteForCustomer({
      userId: command.userId,
      modifiedTotal: command.amount
    });
    await sendText(message.from, `Modified quote to ${command.amount} and sent it to ${command.userId}.`);
  }
}

function readAdminCommand(message) {
  const id =
    message.interactive?.button_reply?.id ??
    message.interactive?.list_reply?.id ??
    "";

  if (id.startsWith("approve_quote:")) {
    return { type: "approve", userId: id.split(":")[1] };
  }

  if (id.startsWith("modify_quote:")) {
    return { type: "modify", userId: id.split(":")[1] };
  }

  const text = message.text?.body?.trim() ?? "";
  const match = text.match(/^MODIFY\s+(\d+)\s+(\d+(?:\.\d{1,2})?)$/i);
  if (match) {
    return {
      type: "modify_with_amount",
      userId: match[1],
      amount: Number(match[2])
    };
  }

  return null;
}
