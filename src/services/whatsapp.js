import { config, isProduction } from "../config.js";
import { sendGreenApiText } from "./greenapi.js";

const graphBaseUrl = `https://graph.facebook.com/${config.WHATSAPP_GRAPH_VERSION}`;

export async function sendText(to, body) {
  if (config.WHATSAPP_PROVIDER === "greenapi") {
    return sendGreenApiText(to, body);
  }

  return sendMessage(buildTextMessagePayload(to, body));
}

export function buildTextMessagePayload(to, body) {
  return {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to,
    type: "text",
    text: {
      preview_url: false,
      body
    }
  };
}

export async function sendInteractiveButtons(to, body, buttons) {
  if (config.WHATSAPP_PROVIDER === "greenapi") {
    const options = buttons.map((button) => `- ${button.title}`).join("\n");
    return sendGreenApiText(to, `${body}\n\n${options}`);
  }

  if (buttons.length > 3) {
    return sendList(to, body, "Choose", buttons.map((button) => ({
      id: button.id,
      title: button.title
    })));
  }

  return sendMessage({
    messaging_product: "whatsapp",
    to,
    type: "interactive",
    interactive: {
      type: "button",
      body: { text: body },
      action: {
        buttons: buttons.slice(0, 3).map((button) => ({
          type: "reply",
          reply: {
            id: button.id,
            title: button.title.slice(0, 20)
          }
        }))
      }
    }
  });
}

export async function sendList(to, body, buttonText, rows) {
  if (config.WHATSAPP_PROVIDER === "greenapi") {
    const options = rows.map((row, index) => `${index + 1}. ${row.title}`).join("\n");
    return sendGreenApiText(to, `${body}\n\n${options}`);
  }

  return sendMessage({
    messaging_product: "whatsapp",
    to,
    type: "interactive",
    interactive: {
      type: "list",
      body: { text: body },
      action: {
        button: buttonText.slice(0, 20),
        sections: [
          {
            title: "Available slots",
            rows: rows.slice(0, 10).map((row) => ({
              id: row.id,
              title: row.title.slice(0, 24),
              description: row.description?.slice(0, 72)
            }))
          }
        ]
      }
    }
  });
}

async function sendMessage(payload) {
  if (config.WHATSAPP_DRY_RUN || !config.WHATSAPP_ACCESS_TOKEN || !config.WHATSAPP_PHONE_NUMBER_ID) {
    if (config.WHATSAPP_DRY_RUN || !isProduction) {
      console.log("WhatsApp dry-run:", JSON.stringify(payload, null, 2));
      return { dryRun: true, payload };
    }
    throw new Error("WhatsApp credentials are not configured");
  }

  const url = `${graphBaseUrl}/${config.WHATSAPP_PHONE_NUMBER_ID}/messages`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.WHATSAPP_ACCESS_TOKEN}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`WhatsApp API error ${response.status}: ${body}`);
  }

  return response.json();
}
