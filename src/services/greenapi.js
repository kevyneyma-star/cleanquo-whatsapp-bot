import { config, isProduction } from "../config.js";

export function isGreenApiConfigured() {
  return Boolean(config.GREEN_API_ID_INSTANCE && config.GREEN_API_TOKEN_INSTANCE);
}

export async function sendGreenApiText(chatId, message) {
  if (config.WHATSAPP_DRY_RUN || !isGreenApiConfigured()) {
    if (config.WHATSAPP_DRY_RUN || !isProduction) {
      console.log("GreenAPI dry-run:", JSON.stringify({ chatId, message }, null, 2));
      return { dryRun: true, chatId, message };
    }
    throw new Error("GreenAPI credentials are not configured");
  }

  const response = await fetch(buildGreenApiUrl("sendMessage"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chatId, message })
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`GreenAPI sendMessage error ${response.status}: ${body}`);
  }

  return response.json();
}

export async function configureGreenApiWebhook(webhookUrl) {
  if (!isGreenApiConfigured()) {
    throw new Error("GreenAPI credentials are not configured");
  }

  const response = await fetch(buildGreenApiUrl("setSettings"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      webhookUrl,
      webhookUrlToken: config.GREEN_API_WEBHOOK_TOKEN ?? "",
      incomingWebhook: "yes",
      outgoingWebhook: "yes",
      outgoingAPIMessageWebhook: "yes",
      stateWebhook: "yes",
      markIncomingMessagesReadedOnReply: "yes"
    })
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`GreenAPI setSettings error ${response.status}: ${body}`);
  }

  return response.json();
}

export function mapGreenApiWebhookToMessage(payload) {
  if (payload?.typeWebhook !== "incomingMessageReceived") return null;

  const chatId = payload.senderData?.chatId;
  const messageData = payload.messageData ?? {};
  const typeMessage = messageData.typeMessage;

  if (!chatId) return null;

  if (typeMessage === "textMessage") {
    return {
      from: chatId,
      type: "text",
      text: { body: messageData.textMessageData?.textMessage ?? "" },
      raw: payload
    };
  }

  if (typeMessage === "extendedTextMessage") {
    return {
      from: chatId,
      type: "text",
      text: { body: messageData.extendedTextMessageData?.text ?? "" },
      raw: payload
    };
  }

  if (typeMessage === "imageMessage") {
    const data = messageData.fileMessageData ?? {};
    return {
      from: chatId,
      type: "image",
      image: {
        id: data.idMessage ?? payload.idMessage,
        mime_type: data.mimeType ?? "image/jpeg",
        sha256: data.sha256,
        caption: data.caption,
        url: data.downloadUrl
      },
      raw: payload
    };
  }

  if (typeMessage === "documentMessage") {
    const data = messageData.fileMessageData ?? {};
    return {
      from: chatId,
      type: "document",
      document: {
        id: data.idMessage ?? payload.idMessage,
        mime_type: data.mimeType ?? "application/pdf",
        sha256: data.sha256,
        filename: data.fileName,
        caption: data.caption,
        url: data.downloadUrl
      },
      raw: payload
    };
  }

  return {
    from: chatId,
    type: "text",
    text: { body: "" },
    raw: payload,
    unsupportedType: typeMessage
  };
}

function buildGreenApiUrl(method) {
  const base = config.GREEN_API_URL.replace(/\/$/, "");
  return `${base}/waInstance${config.GREEN_API_ID_INSTANCE}/${method}/${config.GREEN_API_TOKEN_INSTANCE}`;
}
