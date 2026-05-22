import http from "node:http";
import { URL } from "node:url";
import { config } from "./config.js";
import { approveQuoteForCustomer } from "./conversation-flow.js";
import {
  handleGreenApiWebhook,
  handleWhatsAppWebhook,
  verifyWebhookChallenge
} from "./webhooks/whatsapp-webhook.js";
import { handleWebsiteLead } from "./webhooks/website-lead.js";
import { configureGreenApiWebhook } from "./services/greenapi.js";
import { store } from "./state/conversation-store.js";

const server = http.createServer(async (request, response) => {
  setSecurityHeaders(response);

  if (request.method === "OPTIONS") {
    response.writeHead(204);
    response.end();
    return;
  }

  try {
    await route(request, response);
  } catch (error) {
    console.error(error);
    sendJson(response, 500, {
      error: "Internal server error",
      message: config.NODE_ENV === "development" ? error.message : undefined
    });
  }
});

server.listen(config.PORT, () => {
  console.log(`Cleaning WhatsApp bot listening on port ${config.PORT}`);
});

async function route(request, response) {
  const url = new URL(request.url, `http://${request.headers.host}`);

  if (request.method === "GET" && url.pathname === "/health") {
    sendJson(response, 200, { ok: true, service: "cleaning-whatsapp-bot" });
    return;
  }

  if (request.method === "GET" && url.pathname === "/webhooks/whatsapp") {
    const challenge = verifyWebhookChallenge(Object.fromEntries(url.searchParams));
    if (!challenge) {
      response.writeHead(403);
      response.end();
      return;
    }
    response.writeHead(200, { "Content-Type": "text/plain" });
    response.end(challenge);
    return;
  }

  if (request.method === "POST" && url.pathname === "/webhooks/whatsapp") {
    const body = await readJson(request);
    await handleWhatsAppWebhook(body);
    response.writeHead(200);
    response.end();
    return;
  }

  if (request.method === "POST" && url.pathname === "/webhooks/greenapi") {
    const body = await readJson(request);
    await handleGreenApiWebhook(
      body,
      request.headers.authorization ?? request.headers["x-green-api-token"]
    );
    response.writeHead(200);
    response.end();
    return;
  }

  if (request.method === "POST" && url.pathname === "/webhooks/website-lead") {
    const body = await readJson(request);
    const result = await handleWebsiteLead(body);
    sendJson(response, 202, result);
    return;
  }

  if (request.method === "POST" && url.pathname === "/admin/greenapi/configure") {
    if (!isAdminAuthorized(request)) {
      response.writeHead(401);
      response.end();
      return;
    }

    if (!config.PUBLIC_BASE_URL) {
      sendJson(response, 400, { error: "PUBLIC_BASE_URL is required" });
      return;
    }

    const webhookUrl = `${config.PUBLIC_BASE_URL.replace(/\/$/, "")}/webhooks/greenapi`;
    const result = await configureGreenApiWebhook(webhookUrl);
    sendJson(response, 200, { ok: true, webhookUrl, result });
    return;
  }

  const approveMatch = url.pathname.match(/^\/admin\/quotes\/([^/]+)\/approve$/);
  if (request.method === "POST" && approveMatch) {
    if (!isAdminAuthorized(request)) {
      response.writeHead(401);
      response.end();
      return;
    }

    const body = await readJson(request);
    const modifiedTotal =
      body?.modifiedTotal === undefined ? undefined : Number(body.modifiedTotal);

    if (Number.isNaN(modifiedTotal)) {
      sendJson(response, 400, { error: "modifiedTotal must be a number" });
      return;
    }

    await approveQuoteForCustomer({
      userId: approveMatch[1],
      modifiedTotal
    });

    sendJson(response, 200, { ok: true });
    return;
  }

  const conversationMatch = url.pathname.match(/^\/admin\/conversations\/([^/]+)$/);
  if (request.method === "GET" && conversationMatch) {
    if (!isAdminAuthorized(request)) {
      response.writeHead(401);
      response.end();
      return;
    }

    const conversation = store.get(conversationMatch[1]);
    if (!conversation) {
      response.writeHead(404);
      response.end();
      return;
    }
    sendJson(response, 200, conversation);
    return;
  }

  sendJson(response, 404, { error: "Not found" });
}

async function readJson(request) {
  const chunks = [];
  for await (const chunk of request) {
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

function isAdminAuthorized(request) {
  return request.headers["x-admin-secret"] === config.ADMIN_APPROVAL_SECRET;
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, { "Content-Type": "application/json" });
  response.end(JSON.stringify(payload));
}

function setSecurityHeaders(response) {
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type,x-admin-secret");
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("X-Frame-Options", "DENY");
  response.setHeader("Referrer-Policy", "no-referrer");
}
