import assert from "node:assert/strict";

const proc =
  globalThis.process ??
  (globalThis.process = {
    env: {},
    cwd: () => globalThis.nodeRepl?.cwd ?? "."
  });

proc.env.WHATSAPP_DRY_RUN = "true";

const { approveQuoteForCustomer, handleInboundMessage } = await import("./conversation-flow.js");
const { store } = await import("./state/conversation-store.js");

const userId = "27821234567";
store.reset(userId);

await handleInboundMessage({ from: userId, type: "text", text: { body: "start" } });
await handleInboundMessage({ from: userId, type: "text", text: { body: "1" } });
await handleInboundMessage({ from: userId, type: "text", text: { body: "1" } });
await handleInboundMessage({ from: userId, type: "text", text: { body: "1" } });
await handleInboundMessage({ from: userId, type: "text", text: { body: "1" } });
await handleInboundMessage({ from: userId, type: "text", text: { body: "1" } });
await handleInboundMessage({ from: userId, type: "text", text: { body: "3" } });
await handleInboundMessage({ from: userId, type: "text", text: { body: "2" } });
await handleInboundMessage({ from: userId, type: "text", text: { body: "1" } });
await handleInboundMessage({ from: userId, type: "text", text: { body: "1, 5" } });
await handleInboundMessage({ from: userId, type: "text", text: { body: "No" } });
await handleInboundMessage({ from: userId, type: "text", text: { body: "No" } });
await handleInboundMessage({ from: userId, type: "text", text: { body: "Generate Quote" } });

assert.equal(store.get(userId).status, "pending_admin_approval");
await approveQuoteForCustomer({ userId });
assert.equal(store.get(userId).status, "quote_sent");

await handleInboundMessage({ from: userId, type: "text", text: { body: "Accept" } });
assert.equal(store.get(userId).status, "waiting_slot_selection");

await handleInboundMessage({
  from: userId,
  type: "interactive",
  interactive: { list_reply: { id: `slot:${store.get(userId).booking.availableSlots[0].id}` } }
});
assert.equal(store.get(userId).status, "waiting_pop");

await handleInboundMessage({
  from: userId,
  type: "image",
  image: { id: "media123", mime_type: "image/jpeg", sha256: "abc" }
});
assert.equal(store.get(userId).status, "pop_received");

console.log("Smoke test passed");
