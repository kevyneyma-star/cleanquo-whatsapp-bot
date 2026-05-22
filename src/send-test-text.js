import { config } from "./config.js";
import { sendText } from "./services/whatsapp.js";

const to = process.argv[2] ?? config.TEST_WHATSAPP_TO ?? config.ADMIN_WHATSAPP_NUMBER;
const body =
  process.argv.slice(3).join(" ") ||
  "WhatsApp API connection test: text delivery is working.";

if (!to) {
  console.error("Usage: npm run send:test -- 27821234567 \"Test message\"");
  process.exit(1);
}

const result = await sendText(to, body);

console.log(
  JSON.stringify(
    {
      ok: true,
      to,
      response: result
    },
    null,
    2
  )
);
