import fs from "node:fs";
import path from "node:path";

const proc = globalThis.process;
const env = proc?.env ?? {};
const cwd = proc?.cwd?.() ?? globalThis.nodeRepl?.cwd ?? ".";

loadDotEnv();

export const config = {
  NODE_ENV: env.NODE_ENV ?? "development",
  PORT: Number(env.PORT ?? 3000),
  PUBLIC_BASE_URL: env.PUBLIC_BASE_URL,
  WHATSAPP_VERIFY_TOKEN: env.WHATSAPP_VERIFY_TOKEN ?? "dev-verify-token",
  WHATSAPP_PROVIDER: env.WHATSAPP_PROVIDER ?? "meta",
  WHATSAPP_ACCESS_TOKEN: env.WHATSAPP_ACCESS_TOKEN,
  WHATSAPP_PHONE_NUMBER_ID: env.WHATSAPP_PHONE_NUMBER_ID,
  WHATSAPP_GRAPH_VERSION: env.WHATSAPP_GRAPH_VERSION ?? "v21.0",
  WHATSAPP_DRY_RUN: env.WHATSAPP_DRY_RUN === "true",
  TEST_WHATSAPP_TO: env.TEST_WHATSAPP_TO,
  GREEN_API_URL: env.GREEN_API_URL ?? "https://api.green-api.com",
  GREEN_API_ID_INSTANCE: env.GREEN_API_ID_INSTANCE,
  GREEN_API_TOKEN_INSTANCE: env.GREEN_API_TOKEN_INSTANCE,
  GREEN_API_WEBHOOK_TOKEN: env.GREEN_API_WEBHOOK_TOKEN,
  OPENAI_API_KEY: env.OPENAI_API_KEY,
  OPENAI_MODEL: env.OPENAI_MODEL ?? "gpt-5.4-mini",
  OPENAI_ENABLED: env.OPENAI_ENABLED === "true",
  ADMIN_WHATSAPP_NUMBER: env.ADMIN_WHATSAPP_NUMBER,
  ADMIN_WEBHOOK_URL: env.ADMIN_WEBHOOK_URL,
  CRM_WEBHOOK_URL: env.CRM_WEBHOOK_URL,
  ADMIN_APPROVAL_SECRET:
    env.ADMIN_APPROVAL_SECRET ?? "dev-admin-secret-change-me",
  CALENDAR_PROVIDER: env.CALENDAR_PROVIDER ?? "manual",
  PAYMENT_BANK_NAME: env.PAYMENT_BANK_NAME ?? "Your Bank",
  PAYMENT_ACCOUNT_NAME: env.PAYMENT_ACCOUNT_NAME ?? "Your Business Name",
  PAYMENT_ACCOUNT_NUMBER: env.PAYMENT_ACCOUNT_NUMBER ?? "0000000000",
  PAYMENT_BRANCH_CODE: env.PAYMENT_BRANCH_CODE ?? "000000",
  PAYMENT_REFERENCE_PREFIX: env.PAYMENT_REFERENCE_PREFIX ?? "CLN",
  PAYMENT_LINK_BASE_URL: env.PAYMENT_LINK_BASE_URL,
  QUOTE_CURRENCY: env.QUOTE_CURRENCY ?? "ZAR",
  QUOTE_VALID_HOURS: Number(env.QUOTE_VALID_HOURS ?? 48)
};

export const isProduction = config.NODE_ENV === "production";

function loadDotEnv() {
  const envPath = path.resolve(cwd, ".env");
  if (!fs.existsSync(envPath)) return;

  const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const [key, ...valueParts] = trimmed.split("=");
    if (env[key]) continue;
    env[key] = valueParts.join("=").replace(/^["']|["']$/g, "");
  }
}
