import { config } from "../config.js";
import { currency } from "../utils/text.js";

export function buildPaymentInstructions({ reference, depositAmount, currencyCode }) {
  const lines = [
    `To lock in your booking, a 50% deposit is required: ${currency(depositAmount, currencyCode)}.`,
    "",
    "Payment details:",
    `Bank: ${config.PAYMENT_BANK_NAME}`,
    `Account name: ${config.PAYMENT_ACCOUNT_NAME}`,
    `Account number: ${config.PAYMENT_ACCOUNT_NUMBER}`,
    `Branch code: ${config.PAYMENT_BRANCH_CODE}`,
    `Reference: ${reference}`
  ];

  if (config.PAYMENT_LINK_BASE_URL) {
    lines.push("", `Payment link: ${config.PAYMENT_LINK_BASE_URL}?ref=${reference}`);
  }

  lines.push(
    "",
    "Please reply here with your Proof of Payment as a PDF, JPG, or PNG file."
  );

  return lines.join("\n");
}
