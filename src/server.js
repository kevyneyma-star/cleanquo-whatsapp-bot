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

  if (request.method === "GET" && url.pathname === "/admin") {
    sendHtml(response, 200, renderAdminDashboard());
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
      userId: decodeURIComponent(approveMatch[1]),
      modifiedTotal
    });

    sendJson(response, 200, { ok: true });
    return;
  }

  if (request.method === "GET" && url.pathname === "/admin/quotes") {
    if (!isAdminAuthorized(request, url)) {
      response.writeHead(401);
      response.end();
      return;
    }

    const quotes = store.list()
      .map((conversation) => ({
        userId: conversation.userId,
        status: conversation.status,
        currentScreen: conversation.current_screen,
        currentBranch: conversation.current_branch,
        profile: conversation.profile,
        quote: conversation.quote,
        pendingAdminAction: conversation.pendingAdminAction,
        updatedAt: conversation.updatedAt
      }));

    sendJson(response, 200, { quotes });
    return;
  }

  if (request.method === "GET" && url.pathname === "/admin/storage") {
    if (!isAdminAuthorized(request, url)) {
      response.writeHead(401);
      response.end();
      return;
    }

    sendJson(response, 200, { storage: store.storageInfo() });
    return;
  }

  const conversationMatch = url.pathname.match(/^\/admin\/conversations\/([^/]+)$/);
  if (request.method === "GET" && conversationMatch) {
    if (!isAdminAuthorized(request, url)) {
      response.writeHead(401);
      response.end();
      return;
    }

    const conversation = store.get(decodeURIComponent(conversationMatch[1]));
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

function isAdminAuthorized(request, url = null) {
  return (
    request.headers["x-admin-secret"] === config.ADMIN_APPROVAL_SECRET ||
    url?.searchParams.get("secret") === config.ADMIN_APPROVAL_SECRET
  );
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, { "Content-Type": "application/json" });
  response.end(JSON.stringify(payload));
}

function sendHtml(response, statusCode, html) {
  response.writeHead(statusCode, { "Content-Type": "text/html; charset=utf-8" });
  response.end(html);
}

function setSecurityHeaders(response) {
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type,x-admin-secret");
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("X-Frame-Options", "DENY");
  response.setHeader("Referrer-Policy", "no-referrer");
}

function renderAdminDashboard() {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>CleanQuo Quote Dashboard</title>
  <style>
    :root { color-scheme: light; font-family: Arial, sans-serif; background: #f7f8fa; color: #1f2933; }
    body { margin: 0; }
    header { background: #111827; color: white; padding: 18px 24px; }
    main { max-width: 1120px; margin: 0 auto; padding: 24px; }
    .bar { display: flex; gap: 12px; align-items: center; justify-content: space-between; margin-bottom: 18px; flex-wrap: wrap; }
    .status { font-size: 14px; color: #52606d; }
    button { border: 0; background: #111827; color: white; padding: 10px 14px; border-radius: 6px; cursor: pointer; font-weight: 700; }
    button.secondary { background: #e4e7eb; color: #1f2933; }
    button.approve { background: #147d64; }
    input { padding: 10px; border: 1px solid #cbd2d9; border-radius: 6px; min-width: 140px; }
    input.secret { min-width: min(420px, 80vw); }
    .grid { display: grid; gap: 14px; }
    .card { background: white; border: 1px solid #d9e2ec; border-radius: 8px; padding: 16px; }
    .card h2 { margin: 0 0 8px; font-size: 18px; }
    .meta { display: grid; grid-template-columns: repeat(auto-fit, minmax(210px, 1fr)); gap: 8px; margin: 12px 0; }
    .label { color: #616e7c; font-size: 12px; text-transform: uppercase; }
    .value { font-weight: 700; margin-top: 2px; }
    .actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; }
    .empty { text-align: center; padding: 42px; color: #616e7c; }
    .pending { color: #9a3412; font-weight: 700; }
    .sent { color: #147d64; font-weight: 700; }
    .auth { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
  </style>
</head>
<body>
  <header>
    <h1>CleanQuo Quote Dashboard</h1>
  </header>
  <main>
    <div class="bar">
      <div>
        <div class="status" id="status">Loading quotes...</div>
      </div>
      <div class="auth">
        <input class="secret" id="secret" type="password" placeholder="Admin approval secret">
        <button class="secondary" id="saveSecret">Use Secret</button>
        <button class="secondary" id="refresh">Refresh</button>
      </div>
    </div>
    <section class="grid" id="quotes"></section>
  </main>
  <script>
    const money = new Intl.NumberFormat("en-ZA", { style: "currency", currency: "ZAR" });
    let secret = new URLSearchParams(location.search).get("secret") || localStorage.getItem("cleanquo_admin_secret") || "";
    document.getElementById("secret").value = secret;
    if (secret) localStorage.setItem("cleanquo_admin_secret", secret);

    document.getElementById("refresh").addEventListener("click", loadQuotes);
    document.getElementById("saveSecret").addEventListener("click", () => {
      secret = document.getElementById("secret").value.trim();
      if (secret) localStorage.setItem("cleanquo_admin_secret", secret);
      loadQuotes();
    });
    loadQuotes();

    async function loadQuotes() {
      secret = document.getElementById("secret").value.trim();
      if (!secret) {
        setStatus("Enter the admin approval secret to load quotes.");
        renderQuotes([]);
        return;
      }
      setStatus("Loading quotes...");
      const response = await fetch("/admin/quotes?secret=" + encodeURIComponent(secret));
      if (!response.ok) {
        localStorage.removeItem("cleanquo_admin_secret");
        setStatus("Could not load quotes. Check the admin approval secret in Render.");
        renderQuotes([]);
        return;
      }
      const data = await response.json();
      renderQuotes(data.quotes || []);
      await loadStorageStatus(data.quotes || []);
    }

    async function loadStorageStatus(quotes) {
      try {
        const response = await fetch("/admin/storage?secret=" + encodeURIComponent(secret));
        if (!response.ok) throw new Error("storage unavailable");
        const data = await response.json();
        const storage = data.storage || {};
        setStatus(quotes.length + " lead(s) found. Storage: " + (storage.exists ? "connected" : "ready") + " (" + storage.count + " saved).");
      } catch {
        setStatus(quotes.length + " lead(s) found.");
      }
    }

    function renderQuotes(quotes) {
      const root = document.getElementById("quotes");
      if (!quotes.length) {
        root.innerHTML = '<div class="card empty">No leads or quotes are saved in this running session yet. When a customer starts the WhatsApp wizard, their progress will appear here. When they tap Generate Quote, the estimate will show with approval buttons.</div>';
        return;
      }

      root.innerHTML = quotes.map((item) => {
        const quote = item.quote || {};
        const profile = item.profile || {};
        const pending = item.status === "pending_admin_approval";
        const hasQuote = Boolean(item.quote);
        const service = profile.serviceRequired || item.currentBranch || "Lead in progress";
        return '<article class="card">' +
          '<h2>' + escapeHtml(service) + '</h2>' +
          '<div class="' + (pending ? "pending" : "sent") + '">' + escapeHtml(item.status) + '</div>' +
          '<div class="meta">' +
            field("Client", item.userId) +
            field("Current Screen", item.currentScreen || "-") +
            field("Property", profile.propertySize) +
            field("Add-ons", profile.addOns || "None") +
            field("Location", profile.location) +
            field("Total", hasQuote ? money.format(quote.total || 0) : "Not generated yet") +
            field("Deposit", hasQuote ? money.format(quote.depositAmount || 0) : "Not generated yet") +
          '</div>' +
          (hasQuote ? '<div class="actions">' +
            '<input id="amount-' + encodeURIComponent(item.userId) + '" type="number" min="0" step="1" placeholder="Modified total">' +
            '<button class="approve" onclick="approveQuote(\\'' + encodeURIComponent(item.userId) + '\\', false)">Approve</button>' +
            '<button onclick="approveQuote(\\'' + encodeURIComponent(item.userId) + '\\', true)">Send Modified</button>' +
          '</div>' : '<div class="status">Waiting for customer to finish the wizard and generate the quote.</div>') +
        '</article>';
      }).join("");
    }

    function field(label, value) {
      return '<div><div class="label">' + escapeHtml(label) + '</div><div class="value">' + escapeHtml(value || "-") + '</div></div>';
    }

    async function approveQuote(encodedUserId, useModified) {
      const input = document.getElementById("amount-" + encodedUserId);
      const body = useModified && input.value ? { modifiedTotal: Number(input.value) } : {};
      const response = await fetch("/admin/quotes/" + encodedUserId + "/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-admin-secret": secret },
        body: JSON.stringify(body)
      });
      if (!response.ok) {
        setStatus("Approval failed. Please refresh and try again.");
        return;
      }
      setStatus("Quote sent to customer.");
      await loadQuotes();
    }

    function setStatus(text) {
      document.getElementById("status").textContent = text;
    }

    function escapeHtml(value) {
      return String(value ?? "").replace(/[&<>"']/g, (char) => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
      }[char]));
    }
  </script>
</body>
</html>`;
}
