import { config } from "./config.js";

assertConfigured("WHATSAPP_ACCESS_TOKEN", config.WHATSAPP_ACCESS_TOKEN);
assertConfigured("WHATSAPP_PHONE_NUMBER_ID", config.WHATSAPP_PHONE_NUMBER_ID);

const url = new URL(
  `https://graph.facebook.com/${config.WHATSAPP_GRAPH_VERSION}/${config.WHATSAPP_PHONE_NUMBER_ID}`
);
url.searchParams.set("fields", "id,display_phone_number,verified_name");

const response = await fetch(url, {
  headers: {
    Authorization: `Bearer ${config.WHATSAPP_ACCESS_TOKEN}`
  }
});

const body = await response.json().catch(async () => ({ raw: await response.text() }));

if (!response.ok) {
  console.error(JSON.stringify({ ok: false, status: response.status, body }, null, 2));
  process.exit(1);
}

console.log(
  JSON.stringify(
    {
      ok: true,
      graphVersion: config.WHATSAPP_GRAPH_VERSION,
      phoneNumberId: body.id,
      displayPhoneNumber: body.display_phone_number ?? null,
      verifiedName: body.verified_name ?? null
    },
    null,
    2
  )
);

function assertConfigured(name, value) {
  if (!value) {
    console.error(`${name} is missing`);
    process.exit(1);
  }
}
