import assert from "node:assert/strict";
import { mapGreenApiWebhookToMessage } from "./services/greenapi.js";

const textMessage = mapGreenApiWebhookToMessage({
  typeWebhook: "incomingMessageReceived",
  idMessage: "msg-1",
  senderData: {
    chatId: "27821234567@c.us",
    sender: "27821234567@c.us"
  },
  messageData: {
    typeMessage: "textMessage",
    textMessageData: {
      textMessage: "Deep cleaning"
    }
  }
});

assert.equal(textMessage.from, "27821234567@c.us");
assert.equal(textMessage.type, "text");
assert.equal(textMessage.text.body, "Deep cleaning");

const pdfMessage = mapGreenApiWebhookToMessage({
  typeWebhook: "incomingMessageReceived",
  idMessage: "msg-2",
  senderData: {
    chatId: "27821234567@c.us"
  },
  messageData: {
    typeMessage: "documentMessage",
    fileMessageData: {
      mimeType: "application/pdf",
      fileName: "pop.pdf",
      downloadUrl: "https://example.com/pop.pdf"
    }
  }
});

assert.equal(pdfMessage.type, "document");
assert.equal(pdfMessage.document.mime_type, "application/pdf");
assert.equal(pdfMessage.document.filename, "pop.pdf");

console.log("GreenAPI mapper smoke test passed");
