import { config } from "./config.js";
import { store } from "./state/conversation-store.js";
import { calculateQuote } from "./services/quote-engine.js";
import { notifyAdminPop, notifyAdminQuote } from "./services/admin.js";
import { getAvailableSlots, holdSlot } from "./services/calendar.js";
import { generateAssistantReply } from "./services/ai-assistant.js";
import { buildPaymentInstructions } from "./services/payment.js";
import { extractInboundMedia, isAllowedPopMedia } from "./services/media.js";
import { sendInteractiveButtons, sendList, sendText } from "./services/whatsapp.js";
import { createReference } from "./utils/ids.js";
import { currency, isAffirmative, isNegative, lower, normalizeText, numberedList } from "./utils/text.js";

const SERVICE_OPTIONS = [
  "Deep Cleaning",
  "Move-In/Out Cleaning",
  "Post-Construction",
  "Standard Cleaning"
];

const STATUS = {
  ASK_SERVICE: "ask_service",
  ASK_PROPERTY_SIZE: "ask_property_size",
  ASK_ADD_ONS: "ask_add_ons",
  ASK_LOCATION: "ask_location",
  PENDING_ADMIN_APPROVAL: "pending_admin_approval",
  QUOTE_SENT: "quote_sent",
  WAITING_SLOT_SELECTION: "waiting_slot_selection",
  WAITING_POP: "waiting_pop",
  POP_RECEIVED: "pop_received",
  CANCELLED: "cancelled"
};

export async function handleInboundMessage(message) {
  const userId = message.from;
  const text = getMessageText(message);
  const media = extractInboundMedia(message);
  const conversation = store.get(userId);

  if (isRestart(text)) {
    store.reset(userId);
    return startConversation(userId);
  }

  if (!conversation) {
    return startConversation(userId);
  }

  if (isNegative(text)) {
    store.upsert(userId, { status: STATUS.CANCELLED });
    await sendText(
      userId,
      "No problem. I have paused this request. Reply “start” whenever you would like a new cleaning quote."
    );
    return;
  }

  switch (conversation.status) {
    case STATUS.ASK_SERVICE:
      return captureService(conversation, message);
    case STATUS.ASK_PROPERTY_SIZE:
      return capturePropertySize(conversation, text);
    case STATUS.ASK_ADD_ONS:
      return captureAddOns(conversation, text);
    case STATUS.ASK_LOCATION:
      return captureLocationAndRequestApproval(conversation, text);
    case STATUS.PENDING_ADMIN_APPROVAL:
      return sendText(
        userId,
        "Thanks, I have your details. Your quote is being reviewed and I will send it here shortly."
      );
    case STATUS.QUOTE_SENT:
      return handleQuoteResponse(conversation, text);
    case STATUS.WAITING_SLOT_SELECTION:
      return handleSlotSelection(conversation, message);
    case STATUS.WAITING_POP:
      return handlePopUpload(conversation, media);
    case STATUS.POP_RECEIVED:
      return sendText(
        userId,
        "Thank you. Your booking is provisionally confirmed while payment clearance is being finalized."
      );
    default:
      store.reset(userId);
      return startConversation(userId);
  }
}

export async function approveQuoteForCustomer({ userId, modifiedTotal }) {
  const conversation = store.get(userId);
  if (!conversation) {
    throw new Error(`Conversation not found for ${userId}`);
  }
  if (!conversation.quote) {
    throw new Error(`No quote exists yet for ${userId}`);
  }

  const quote = {
    ...conversation.quote,
    total: modifiedTotal ?? conversation.quote.total,
    depositAmount: Math.ceil((modifiedTotal ?? conversation.quote.total) * 0.5)
  };

  store.upsert(userId, {
    status: STATUS.QUOTE_SENT,
    quote,
    pendingAdminAction: null
  });

  await sendInteractiveButtons(userId, formatCustomerQuote(quote), [
    { id: "accept_quote", title: "Accept" },
    { id: "ask_question", title: "Ask Question" }
  ]);
}

async function startConversation(userId) {
  store.upsert(userId, { status: STATUS.ASK_SERVICE, profile: {} });
  await sendText(
    userId,
    [
      "😊Welcome to CleanQuo",
      "Premium Deep Cleaning Services",
      "",
      "One of our team members will respond to you shortly. To get your quote sorted faster, please send us:",
      "",
      "1. Name:",
      "2. Email:",
      "3. Location:",
      "",
      "Let us know how we can make your space shine!",
      "✨Home & Office Deep Cleaning",
      "✨ Commercial & Industrial Deep Cleaning",
      "✨Post-Construction Cleaning",
      "✨ Move-In / Move-Out Deep Cleaning",
      "✨Carpet & Upholstery Cleaning",
      "✨Contract Cleaning & Staff Placement",
      "",
      "Which cleaning service do you need today?"
    ].join("\n")
  );
  await sendText(userId, numberedList(SERVICE_OPTIONS));
}

async function captureService(conversation, message) {
  const selected = getInteractiveSelection(message) ?? normalizeText(getMessageText(message));
  const serviceRequired = mapService(selected);

  if (!serviceRequired) {
    await sendText(
      conversation.userId,
      `Please choose one of these services:\n${numberedList(SERVICE_OPTIONS)}`
    );
    return;
  }

  store.upsert(conversation.userId, {
    status: STATUS.ASK_PROPERTY_SIZE,
    profile: { serviceRequired }
  });

  await sendText(
    conversation.userId,
    "Great. What is the property size or type? You can reply with bedrooms and bathrooms, or the square meterage."
  );
}

async function capturePropertySize(conversation, text) {
  if (!normalizeText(text)) {
    await sendText(conversation.userId, "Please send the property size, for example “3 bedrooms, 2 bathrooms” or “120 sqm”.");
    return;
  }

  store.upsert(conversation.userId, {
    status: STATUS.ASK_ADD_ONS,
    profile: { propertySize: normalizeText(text) }
  });

  await sendText(
    conversation.userId,
    "Do you need any add-ons? For example carpet cleaning, window cleaning, upholstery, or oven deep clean. Reply “none” if not."
  );
}

async function captureAddOns(conversation, text) {
  store.upsert(conversation.userId, {
    status: STATUS.ASK_LOCATION,
    profile: { addOns: normalizeText(text) || "None" }
  });

  await sendText(conversation.userId, "Thanks. Which suburb or area is the property in?");
}

async function captureLocationAndRequestApproval(conversation, text) {
  if (!normalizeText(text)) {
    await sendText(conversation.userId, "Please send the property suburb or area so I can prepare the estimate.");
    return;
  }

  const updated = store.upsert(conversation.userId, {
    status: STATUS.PENDING_ADMIN_APPROVAL,
    profile: { location: normalizeText(text) }
  });
  const quote = calculateQuote(updated.profile);
  const pendingAdminAction = {
    type: "quote_approval",
    requestedAt: new Date().toISOString()
  };

  const withQuote = store.upsert(conversation.userId, {
    quote,
    pendingAdminAction
  });

  await sendText(
    conversation.userId,
    "Thank you. I have your details and I’m preparing your quote now. I’ll send it here shortly."
  );
  await notifyAdminQuote({ conversation: withQuote, quote });
}

async function handleQuoteResponse(conversation, text) {
  if (!isAffirmative(text)) {
    const aiReply = await generateAssistantReply({ conversation, userText: text });
    if (aiReply) {
      await sendText(conversation.userId, aiReply);
      return;
    }

    await sendText(
      conversation.userId,
      "Thanks. Reply “Accept” when you are ready to continue, or send your question and our team will assist."
    );
    return;
  }

  const slots = await getAvailableSlots({ location: conversation.profile.location });
  store.upsert(conversation.userId, {
    status: STATUS.WAITING_SLOT_SELECTION,
    booking: {
      ...(conversation.booking ?? {}),
      availableSlots: slots
    }
  });

  await sendList(
    conversation.userId,
    "Great, please choose a preferred date and time from the available slots.",
    "Select slot",
    slots.map((slot) => ({
      id: `slot:${slot.id}`,
      title: slot.label,
      description: conversation.profile.location
    }))
  );
}

async function handleSlotSelection(conversation, message) {
  const selection = getInteractiveSelection(message) ?? normalizeText(getMessageText(message));
  const slotId = selection.replace(/^slot:/i, "");
  const slots = conversation.booking?.availableSlots ?? [];
  const selectedSlot =
    slots.find((slot) => slot.id === slotId) ??
    slots[Number(selection) - 1];

  if (!selectedSlot) {
    await sendText(
      conversation.userId,
      "Please select one of the listed booking slots so I can hold it for you."
    );
    return;
  }

  const hold = await holdSlot({ userId: conversation.userId, slot: selectedSlot });
  const paymentReference = createReference(config.PAYMENT_REFERENCE_PREFIX);
  const booking = {
    ...conversation.booking,
    selectedSlot,
    hold,
    paymentReference,
    status: "awaiting_deposit"
  };

  store.upsert(conversation.userId, {
    status: STATUS.WAITING_POP,
    booking
  });

  await sendText(
    conversation.userId,
    `Perfect. I’ve provisionally held ${selectedSlot.label} for you.`
  );
  await sendText(
    conversation.userId,
    buildPaymentInstructions({
      reference: paymentReference,
      depositAmount: conversation.quote.depositAmount,
      currencyCode: conversation.quote.currency
    })
  );
}

async function handlePopUpload(conversation, media) {
  if (!media) {
    await sendText(
      conversation.userId,
      "Please upload your Proof of Payment as a PDF, JPG, or PNG file so we can verify the deposit."
    );
    return;
  }

  if (!isAllowedPopMedia(media)) {
    await sendText(
      conversation.userId,
      "I received the file, but POP must be a PDF, JPG, or PNG. Please resend it in one of those formats."
    );
    return;
  }

  const updated = store.upsert(conversation.userId, {
    status: STATUS.POP_RECEIVED,
    booking: {
      ...conversation.booking,
      status: "pending_bank_clearance",
      pop: {
        ...media,
        receivedAt: new Date().toISOString()
      }
    }
  });

  await notifyAdminPop({ conversation: updated, media });
  await sendText(
    conversation.userId,
    "Thank you, your POP has been received. Your booking is provisionally confirmed pending final bank clearance."
  );
}

function formatCustomerQuote(quote) {
  const addOns = quote.addOns.length
    ? quote.addOns.map((item) => item.name).join(", ")
    : "No add-ons";

  return [
    "Your cleaning quote is ready.",
    "",
    `Service: ${quote.service}`,
    `Add-ons: ${addOns}`,
    `Estimated total: ${currency(quote.total, quote.currency)}`,
    `50% deposit to book: ${currency(quote.depositAmount, quote.currency)}`,
    "",
    "Reply “Accept” to continue to booking, or ask a question and our team will assist."
  ].join("\n");
}

function mapService(value = "") {
  const text = lower(value);
  const byNumber = SERVICE_OPTIONS[Number(text) - 1];
  if (byNumber) return byNumber;
  return SERVICE_OPTIONS.find((option) => text.includes(option.toLowerCase().split(" ")[0]));
}

function getMessageText(message) {
  if (message.type === "text") return message.text?.body ?? "";
  return getInteractiveSelection(message) ?? "";
}

function getInteractiveSelection(message) {
  if (message.type !== "interactive") return null;
  return (
    message.interactive?.button_reply?.id ??
    message.interactive?.list_reply?.id ??
    message.interactive?.button_reply?.title ??
    message.interactive?.list_reply?.title ??
    null
  );
}

function isRestart(text = "") {
  return /^(start|restart|new quote|quote)$/i.test(normalizeText(text));
}
