import { config } from "../config.js";

const SYSTEM_PROMPT = [
  "You are CleanQuo's WhatsApp assistant.",
  "Reply in polite, concise mobile-friendly English.",
  "Do not invent prices, booking slots, payment clearance, or policy decisions.",
  "If the customer asks for something operational, guide them back to the current quote or booking step.",
  "Keep replies under 80 words unless the customer asks for detail."
].join(" ");

export async function generateAssistantReply({ conversation, userText }) {
  if (!config.OPENAI_ENABLED || !config.OPENAI_API_KEY) return null;

  const context = conversation
    ? {
        status: conversation.status,
        profile: conversation.profile,
        quote: conversation.quote,
        booking: conversation.booking
      }
    : null;

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.OPENAI_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: config.OPENAI_MODEL,
      max_output_tokens: 320,
      reasoning: { effort: "minimal" },
      text: { verbosity: "low" },
      input: [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content: `Conversation context:\n${JSON.stringify(context)}\n\nCustomer message:\n${userText}`
        }
      ]
    })
  });

  if (!response.ok) {
    const body = await response.text();
    console.warn(`OpenAI response failed ${response.status}: ${body.slice(0, 500)}`);
    return null;
  }

  const data = await response.json();
  return extractOutputText(data);
}

function extractOutputText(data) {
  if (typeof data.output_text === "string" && data.output_text.trim()) {
    return data.output_text.trim();
  }

  const parts = [];
  for (const item of data.output ?? []) {
    for (const content of item.content ?? []) {
      if (content.type === "output_text" && content.text) {
        parts.push(content.text);
      }
    }
  }

  return parts.join("\n").trim() || null;
}
