import { config } from "./config.js";
import { store } from "./state/conversation-store.js";
import { calculateQuote } from "./services/quote-engine.js";
import { notifyAdminPop, notifyAdminQuote } from "./services/admin.js";
import { sendCrmQuotePayload } from "./services/crm.js";
import { getAvailableSlots, holdSlot } from "./services/calendar.js";
import { generateAssistantReply } from "./services/ai-assistant.js";
import { buildPaymentInstructions } from "./services/payment.js";
import { extractInboundMedia, isAllowedPopMedia } from "./services/media.js";
import { sendInteractiveButtons, sendList, sendText } from "./services/whatsapp.js";
import { createReference } from "./utils/ids.js";
import { currency, isAffirmative, normalizeText, numberedList } from "./utils/text.js";

const SESSION_TIMEOUT_MS = 15 * 60 * 1000;

const STATUS = {
  WIZARD: "wizard",
  PENDING_ADMIN_APPROVAL: "pending_admin_approval",
  QUOTE_SENT: "quote_sent",
  WAITING_SLOT_SELECTION: "waiting_slot_selection",
  WAITING_POP: "waiting_pop",
  POP_RECEIVED: "pop_received",
  CANCELLED: "cancelled"
};

const SCREENS = {
  WELCOME: "WELCOME",
  SERVICE_SELECTION: "SERVICE_SELECTION",
  A_PROPERTY_TYPE: "A_PROPERTY_TYPE",
  A_IS_FURNISHED: "A_IS_FURNISHED",
  A_STRUCTURE: "A_STRUCTURE",
  A_BEDROOMS: "A_BEDROOMS",
  A_BEDROOMS_CUSTOM: "A_BEDROOMS_CUSTOM",
  A_BATHROOMS: "A_BATHROOMS",
  A_BATHROOMS_CUSTOM: "A_BATHROOMS_CUSTOM",
  A_WINDOWS: "A_WINDOWS",
  A_EXTRA_AREAS: "A_EXTRA_AREAS",
  A_QUARTERS: "A_QUARTERS",
  A_QUARTERS_BEDROOMS: "A_QUARTERS_BEDROOMS",
  A_QUARTERS_BATHROOMS: "A_QUARTERS_BATHROOMS",
  A_QUARTERS_LIVING: "A_QUARTERS_LIVING",
  A_UPHOLSTERY_ADDONS: "A_UPHOLSTERY_ADDONS",
  B_PROPERTY_TYPE: "B_PROPERTY_TYPE",
  B_IS_FURNISHED: "B_IS_FURNISHED",
  B_ITEM_SELECTION: "B_ITEM_SELECTION",
  B_FITTED_ROOMS: "B_FITTED_ROOMS",
  B_LOOSE_DETAILS: "B_LOOSE_DETAILS",
  B_COUCH_TYPE: "B_COUCH_TYPE",
  B_COUCH_SEATS: "B_COUCH_SEATS",
  B_MATTRESS_SIZES: "B_MATTRESS_SIZES",
  B_OTHER_TEXT: "B_OTHER_TEXT",
  C_PROPERTY_TYPE: "C_PROPERTY_TYPE",
  C_CONTRACT_TYPE: "C_CONTRACT_TYPE",
  C_DAYS_PER_WEEK: "C_DAYS_PER_WEEK",
  C_PREFERENCES: "C_PREFERENCES",
  D_IS_FURNISHED: "D_IS_FURNISHED",
  D_STRUCTURE: "D_STRUCTURE",
  D_KNOWS_SQM: "D_KNOWS_SQM",
  D_SQM: "D_SQM",
  D_SITE_VISIT_SLOT: "D_SITE_VISIT_SLOT",
  REVIEW: "REVIEW",
  EDIT_SELECTION: "EDIT_SELECTION"
};

const SERVICES = [
  { id: "move", title: "Move In / Out Cleaning", branch: "BRANCH_A_DEEP_CLEAN" },
  { id: "post", title: "Post Construction Cleaning", branch: "BRANCH_A_DEEP_CLEAN" },
  { id: "spring", title: "Spring Cleaning", branch: "BRANCH_A_DEEP_CLEAN" },
  { id: "carpet", title: "Carpet & Upholstery Cleaning", branch: "BRANCH_B_CARPETS" },
  { id: "contract", title: "Contract Cleaning", branch: "BRANCH_C_DOMESTIC" },
  { id: "commercial", title: "Commercial & Industrial Cleaning", branch: "BRANCH_D_COMMERCIAL" }
];

const EXTRA_AREAS = [
  "Kitchen", "Pantry", "Scullery", "Laundry", "Dining", "Living Room",
  "Pyjama Lounge", "Patio", "Balcony", "Braai Area", "Lapa",
  "Storeroom", "Walk-In Closet", "Study", "Office"
];

const UPHOLSTERY_ITEMS = ["Fitted Carpet", "Loose Carpet", "Couch", "Mattress", "Other"];
const FITTED_LOCATIONS = ["Bedroom", "Lounge", "Office", "Closet", "Bathroom"];
const MATTRESS_SIZES = ["King", "Queen", "Double", "Three Quarter", "Single"];

export async function handleInboundMessage(message) {
  const userId = message.from;
  const text = getMessageText(message);
  const media = extractInboundMedia(message);
  const conversation = store.get(userId);

  if (isRestart(text)) {
    return startConversation(userId);
  }

  if (!conversation) return startConversation(userId);

  if (isTimedOut(conversation)) {
    await sendText(userId, "Welcome back. I saved your progress, so we can continue from where you left off.");
    store.upsert(userId, { recoveredAt: new Date().toISOString() });
    return renderCurrentScreen(store.get(userId));
  }

  if (isCancelRequest(text) && conversation.status !== STATUS.WAITING_POP) {
    store.upsert(userId, { status: STATUS.CANCELLED });
    await sendText(userId, "No problem. I have paused this request. Reply \"start\" whenever you would like a new cleaning quote.");
    return;
  }

  if (conversation.status === STATUS.WIZARD) return handleWizardStep(conversation, message);
  if (conversation.status === STATUS.PENDING_ADMIN_APPROVAL) {
    return sendText(userId, "Thanks, I have your details. Your quote is being reviewed and I will send it here shortly.");
  }
  if (conversation.status === STATUS.QUOTE_SENT) return handleQuoteResponse(conversation, text);
  if (conversation.status === STATUS.WAITING_SLOT_SELECTION) return handleSlotSelection(conversation, message);
  if (conversation.status === STATUS.WAITING_POP) return handlePopUpload(conversation, media);
  if (conversation.status === STATUS.POP_RECEIVED) {
    return sendText(userId, "Thank you. Your booking is provisionally confirmed while payment clearance is being finalized.");
  }

  store.reset(userId);
  return startConversation(userId);
}

export async function approveQuoteForCustomer({ userId, modifiedTotal }) {
  const conversation = store.get(userId);
  if (!conversation) throw new Error(`Conversation not found for ${userId}`);
  if (!conversation.quote) throw new Error(`No quote exists yet for ${userId}`);

  const quote = {
    ...conversation.quote,
    total: modifiedTotal ?? conversation.quote.total,
    depositAmount: Math.ceil((modifiedTotal ?? conversation.quote.total) * 0.5),
    status: STATUS.QUOTE_SENT,
    approvedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  store.upsert(userId, {
    status: STATUS.QUOTE_SENT,
    quote,
    quote_history: updateQuoteHistory(conversation, quote),
    pendingAdminAction: null
  });

  await sendInteractiveButtons(userId, formatCustomerQuote(quote), [
    { id: "accept_quote", title: "Accept" },
    { id: "ask_question", title: "Ask Question" }
  ]);
}

async function startConversation(userId) {
  const session = createInitialSession(userId);
  const existing = store.get(userId);
  if (existing?.quote_history?.length) session.quote_history = existing.quote_history;
  store.upsert(userId, session);
  await sendInteractiveButtons(
    userId,
    [
      "👋 Welcome to CleanQuo",
      "",
      "Professional Cleaning Services",
      "",
      "We'll ask a few quick questions to prepare your quotation.",
      "",
      "Average completion time:",
      "1 - 2 minutes."
    ].join("\n"),
    [{ id: "start_quote", title: "Start Quote" }]
  );
}

async function handleWizardStep(conversation, message) {
  const selection = getSelection(message);
  const text = normalizeText(getMessageText(message));

  if (conversation.current_screen !== SCREENS.REVIEW && /^edit$/i.test(text)) {
    updateSession(conversation.userId, { previous_screen: conversation.current_screen, current_screen: SCREENS.EDIT_SELECTION });
    return renderCurrentScreen(store.get(conversation.userId));
  }

  switch (conversation.current_screen) {
    case SCREENS.WELCOME:
      if (selection || /^[1-6]$/.test(text) || findBySelection(SERVICES, text)) {
        const ready = updateSession(conversation.userId, { current_screen: SCREENS.SERVICE_SELECTION });
        return captureService(ready, selection || text);
      }
      return transition(conversation, { current_screen: SCREENS.SERVICE_SELECTION });
    case SCREENS.SERVICE_SELECTION:
      return captureService(conversation, selection || text);
    case SCREENS.A_PROPERTY_TYPE:
      return captureChoice(conversation, "property_type", selection || text, ["House", "Apartment", "Office"], SCREENS.A_IS_FURNISHED);
    case SCREENS.A_IS_FURNISHED:
      return captureChoice(conversation, "is_furnished", selection || text, ["Empty", "Furnished"], SCREENS.A_STRUCTURE);
    case SCREENS.A_STRUCTURE:
      return captureChoice(conversation, "property_structure", selection || text, ["Single Story", "Double Story", "Other"], SCREENS.A_BEDROOMS);
    case SCREENS.A_BEDROOMS:
      return captureCountOrCustom(conversation, "bedroom_count", selection || text, SCREENS.A_BEDROOMS_CUSTOM, SCREENS.A_BATHROOMS);
    case SCREENS.A_BEDROOMS_CUSTOM:
      return captureNumber(conversation, "bedroom_count", text, SCREENS.A_BATHROOMS);
    case SCREENS.A_BATHROOMS:
      return captureCountOrCustom(conversation, "bathroom_count", selection || text, SCREENS.A_BATHROOMS_CUSTOM, SCREENS.A_WINDOWS);
    case SCREENS.A_BATHROOMS_CUSTOM:
      return captureNumber(conversation, "bathroom_count", text, SCREENS.A_WINDOWS);
    case SCREENS.A_WINDOWS:
      return captureChoice(conversation, "window_type", selection || text, ["Single Volume", "Double Volume", "Full Length"], SCREENS.A_EXTRA_AREAS);
    case SCREENS.A_EXTRA_AREAS:
      return captureMultiSelect(conversation, "extra_rooms_list", selection || text, EXTRA_AREAS, SCREENS.A_QUARTERS);
    case SCREENS.A_QUARTERS:
      return captureQuartersExists(conversation, selection || text);
    case SCREENS.A_QUARTERS_BEDROOMS:
      return captureQuartersNumber(conversation, "bedrooms", text, SCREENS.A_QUARTERS_BATHROOMS);
    case SCREENS.A_QUARTERS_BATHROOMS:
      return captureQuartersNumber(conversation, "bathrooms", text, SCREENS.A_QUARTERS_LIVING);
    case SCREENS.A_QUARTERS_LIVING:
      return captureQuartersLiving(conversation, selection || text);
    case SCREENS.A_UPHOLSTERY_ADDONS:
      return isYes(selection || text) ? transition(conversation, { current_screen: SCREENS.B_ITEM_SELECTION, subflow_return_screen: SCREENS.REVIEW }) : transition(conversation, { current_screen: SCREENS.REVIEW });
    case SCREENS.B_PROPERTY_TYPE:
      return captureChoice(conversation, "property_type", selection || text, ["House", "Apartment", "Office"], SCREENS.B_IS_FURNISHED);
    case SCREENS.B_IS_FURNISHED:
      return captureChoice(conversation, "is_furnished", selection || text, ["Empty", "Furnished"], SCREENS.B_ITEM_SELECTION);
    case SCREENS.B_ITEM_SELECTION:
      return captureUpholsteryItems(conversation, selection || text);
    case SCREENS.B_FITTED_ROOMS:
      return captureUpholsteryArray(conversation, "fitted_details", selection || text, FITTED_LOCATIONS);
    case SCREENS.B_LOOSE_DETAILS:
      return captureUpholsteryText(conversation, "loose_details", text);
    case SCREENS.B_COUCH_TYPE:
      return captureCouchType(conversation, selection || text);
    case SCREENS.B_COUCH_SEATS:
      return captureCouchSeats(conversation, selection || text);
    case SCREENS.B_MATTRESS_SIZES:
      return captureMattressSizes(conversation, selection || text);
    case SCREENS.B_OTHER_TEXT:
      return captureUpholsteryOther(conversation, text);
    case SCREENS.C_PROPERTY_TYPE:
      return captureChoice(conversation, "property_type", selection || text, ["House", "Apartment", "Office"], SCREENS.C_CONTRACT_TYPE);
    case SCREENS.C_CONTRACT_TYPE:
      return captureChoice(conversation, "contract_type", selection || text, ["Stay In", "Stay Out"], SCREENS.C_DAYS_PER_WEEK);
    case SCREENS.C_DAYS_PER_WEEK:
      return captureNumber(conversation, "days_per_week", text || selection, SCREENS.C_PREFERENCES, { min: 1, max: 7 });
    case SCREENS.C_PREFERENCES:
      return transition(conversation, { personal_preferences: text || "None", current_screen: SCREENS.REVIEW });
    case SCREENS.D_IS_FURNISHED:
      return captureChoice(conversation, "is_furnished", selection || text, ["Empty", "Furnished"], SCREENS.D_STRUCTURE);
    case SCREENS.D_STRUCTURE:
      return captureChoice(conversation, "property_structure", selection || text, ["Single Story", "Double Story", "Other"], SCREENS.D_KNOWS_SQM);
    case SCREENS.D_KNOWS_SQM:
      return isYes(selection || text) ? transition(conversation, { current_screen: SCREENS.D_SQM }) : showSiteVisitSlots(conversation);
    case SCREENS.D_SQM:
      return captureNumber(conversation, "property_sqm", text, SCREENS.REVIEW, { min: 1 });
    case SCREENS.D_SITE_VISIT_SLOT:
      return captureSiteVisitSlot(conversation, message);
    case SCREENS.REVIEW:
      return handleReview(conversation, selection || text);
    case SCREENS.EDIT_SELECTION:
      return handleEditSelection(conversation, selection || text);
    default:
      return transition(conversation, { current_screen: SCREENS.SERVICE_SELECTION });
  }
}

async function captureService(conversation, value) {
  const service = findBySelection(SERVICES, value);
  if (!service) return renderServiceSelection(conversation.userId, "Please choose one of the listed services.");

  const nextScreen = {
    BRANCH_A_DEEP_CLEAN: SCREENS.A_PROPERTY_TYPE,
    BRANCH_B_CARPETS: SCREENS.B_PROPERTY_TYPE,
    BRANCH_C_DOMESTIC: SCREENS.C_PROPERTY_TYPE,
    BRANCH_D_COMMERCIAL: SCREENS.D_IS_FURNISHED
  }[service.branch];

  return transition(conversation, {
    current_branch: service.branch,
    current_screen: nextScreen,
    service_required: service.title,
    total_steps: service.branch === "BRANCH_A_DEEP_CLEAN" ? 5 : service.branch === "BRANCH_B_CARPETS" ? 3 : 4,
    current_step: 1
  });
}

async function captureChoice(conversation, key, value, options, nextScreen) {
  const selected = findOption(options, value);
  if (!selected) {
    await sendText(conversation.userId, "Please choose one of the available options.");
    return renderCurrentScreen(conversation);
  }
  return transition(conversation, { [key]: selected, current_screen: nextScreen });
}

async function captureCountOrCustom(conversation, key, value, customScreen, nextScreen) {
  if (/^5\+$/i.test(value)) return transition(conversation, { current_screen: customScreen });
  return captureNumber(conversation, key, value, nextScreen, { min: 0 });
}

async function captureNumber(conversation, key, value, nextScreen, { min = 0, max = 99999 } = {}) {
  const number = Number(String(value).replace(/[^\d.]/g, ""));
  if (!Number.isFinite(number) || number < min || number > max) {
    await sendText(conversation.userId, `Please reply with a number from ${min} to ${max}.`);
    return renderCurrentScreen(conversation);
  }
  return transition(conversation, { [key]: number, current_screen: nextScreen });
}

async function captureMultiSelect(conversation, key, value, options, nextScreen) {
  const selected = parseMultiSelect(value, options);
  if (!selected.length) {
    await sendText(conversation.userId, "Please select one or more items by replying with their numbers, separated by commas. Example: 1, 3, 5");
    return renderCurrentScreen(conversation);
  }
  return transition(conversation, { [key]: selected, current_screen: nextScreen });
}

async function captureQuartersExists(conversation, value) {
  if (!isYes(value)) {
    return transition(conversation, {
      quarters_details: { exists: false, bedrooms: 0, bathrooms: 0, living_dining: false },
      current_screen: SCREENS.A_UPHOLSTERY_ADDONS
    });
  }
  return transition(conversation, {
    quarters_details: { ...conversation.quarters_details, exists: true },
    current_screen: SCREENS.A_QUARTERS_BEDROOMS
  });
}

async function captureQuartersNumber(conversation, key, value, nextScreen) {
  const number = Number(String(value).replace(/\D/g, ""));
  if (!Number.isFinite(number) || number < 0) {
    await sendText(conversation.userId, "Please reply with a valid number.");
    return renderCurrentScreen(conversation);
  }
  return transition(conversation, {
    quarters_details: { ...conversation.quarters_details, [key]: number },
    current_screen: nextScreen
  });
}

async function captureQuartersLiving(conversation, value) {
  return transition(conversation, {
    quarters_details: { ...conversation.quarters_details, living_dining: isYes(value) },
    current_screen: SCREENS.A_UPHOLSTERY_ADDONS
  });
}

async function captureUpholsteryItems(conversation, value) {
  const selected = parseMultiSelect(value, UPHOLSTERY_ITEMS);
  if (!selected.length) {
    await sendText(conversation.userId, "Please select at least one item.");
    return renderCurrentScreen(conversation);
  }
  const specs = { ...conversation.upholstery_specs, selected_items: selected };
  return transition(conversation, { upholstery_specs: specs, current_screen: nextUpholsteryScreen(specs) });
}

async function captureUpholsteryArray(conversation, key, value, options) {
  const selected = parseMultiSelect(value, options);
  if (!selected.length) {
    await sendText(conversation.userId, "Please select one or more options.");
    return renderCurrentScreen(conversation);
  }
  const specs = { ...conversation.upholstery_specs, [key]: selected };
  return transition(conversation, { upholstery_specs: specs, current_screen: nextUpholsteryScreen(specs) });
}

async function captureUpholsteryText(conversation, key, value) {
  const specs = { ...conversation.upholstery_specs, [key]: [normalizeText(value) || "Details to confirm"] };
  return transition(conversation, { upholstery_specs: specs, current_screen: nextUpholsteryScreen(specs) });
}

async function captureCouchType(conversation, value) {
  const type = findOption(["L Shape", "U Shape", "Sleeper", "Standard"], value);
  if (!type) return renderCurrentScreen(conversation);
  const specs = { ...conversation.upholstery_specs, couch_specs: { ...conversation.upholstery_specs.couch_specs, configuration: type } };
  return transition(conversation, { upholstery_specs: specs, current_screen: SCREENS.B_COUCH_SEATS });
}

async function captureCouchSeats(conversation, value) {
  const seats = /^4\+$/i.test(value) ? "4+" : String(Number(value));
  if (!/^(1|2|3|4\+)$/.test(seats)) return renderCurrentScreen(conversation);
  const specs = { ...conversation.upholstery_specs, couch_specs: { ...conversation.upholstery_specs.couch_specs, seats } };
  return transition(conversation, { upholstery_specs: specs, current_screen: nextUpholsteryScreen(specs) });
}

async function captureMattressSizes(conversation, value) {
  const selected = parseMultiSelect(value, MATTRESS_SIZES);
  if (!selected.length) return renderCurrentScreen(conversation);
  const specs = { ...conversation.upholstery_specs, mattress_sizes: selected };
  return transition(conversation, { upholstery_specs: specs, current_screen: nextUpholsteryScreen(specs) });
}

async function captureUpholsteryOther(conversation, value) {
  const specs = { ...conversation.upholstery_specs, other_text: normalizeText(value) || "Other items to confirm" };
  return transition(conversation, { upholstery_specs: specs, current_screen: nextUpholsteryScreen(specs) });
}

async function showSiteVisitSlots(conversation) {
  const slots = await getAvailableSlots({ location: "Site visit" });
  return transition(conversation, {
    site_visit_slots: slots,
    current_screen: SCREENS.D_SITE_VISIT_SLOT
  });
}

async function captureSiteVisitSlot(conversation, message) {
  const selection = getSelection(message) || normalizeText(getMessageText(message));
  const slots = conversation.site_visit_slots ?? [];
  const selectedSlot = slots.find((slot) => slot.id === selection.replace(/^slot:/i, "")) ?? slots[Number(selection) - 1];
  if (!selectedSlot) return renderCurrentScreen(conversation);
  return transition(conversation, {
    site_visit_booked: true,
    booking: { ...(conversation.booking ?? {}), siteVisitSlot: selectedSlot },
    current_screen: SCREENS.REVIEW
  });
}

async function handleReview(conversation, value) {
  if (/^(edit|1)$/i.test(value)) return transition(conversation, { previous_screen: SCREENS.REVIEW, current_screen: SCREENS.EDIT_SELECTION });
  if (!/^(2)$|generate|quote|yes|proceed|approve/i.test(value)) {
    await sendText(conversation.userId, "Please choose Edit or Generate Quote.");
    return renderCurrentScreen(conversation);
  }
  return generateQuoteForApproval(conversation);
}

async function handleEditSelection(conversation, value) {
  const fields = [
    { title: "Service", screen: SCREENS.SERVICE_SELECTION },
    { title: "Property Type", screen: conversation.current_branch === "BRANCH_B_CARPETS" ? SCREENS.B_PROPERTY_TYPE : SCREENS.A_PROPERTY_TYPE },
    { title: "Bedrooms", screen: SCREENS.A_BEDROOMS },
    { title: "Bathrooms", screen: SCREENS.A_BATHROOMS },
    { title: "Extra Areas", screen: SCREENS.A_EXTRA_AREAS },
    { title: "Upholstery", screen: SCREENS.B_ITEM_SELECTION }
  ];
  const selected = findBySelection(fields.map((item, index) => ({ id: String(index + 1), title: item.title, screen: item.screen })), value);
  if (!selected) return renderCurrentScreen(conversation);
  return transition(conversation, { current_screen: selected.screen, return_to_review: true });
}

async function generateQuoteForApproval(conversation) {
  const profile = buildLegacyProfile(conversation);
  const requestedAt = new Date().toISOString();
  const updated = updateSession(conversation.userId, {
    status: STATUS.PENDING_ADMIN_APPROVAL,
    profile,
    current_screen: "QUOTE_SCREEN",
    quote_ready: true
  });
  const quote = {
    ...calculateQuote(profile, updated),
    quoteId: createReference("CQ"),
    status: STATUS.PENDING_ADMIN_APPROVAL,
    enquiredAt: updated.createdAt ?? requestedAt,
    requestedAt,
    updatedAt: requestedAt
  };
  const withQuote = store.upsert(conversation.userId, {
    quote,
    quote_history: [...(updated.quote_history ?? []), quote],
    pendingAdminAction: { type: "quote_approval", requestedAt: new Date().toISOString() }
  });

  await sendText(conversation.userId, "Thank you. Your details are saved and your quote is being prepared for review.");
  await Promise.allSettled([
    notifyAdminQuote({ conversation: withQuote, quote }),
    sendCrmQuotePayload({ conversation: withQuote, quote })
  ]);
}

async function handleQuoteResponse(conversation, text) {
  if (!isAffirmative(text)) {
    const aiReply = await generateAssistantReply({ conversation, userText: text });
    await sendText(conversation.userId, aiReply || "Thanks. Reply \"Accept\" when you are ready to continue, or send your question and our team will assist.");
    return;
  }
  const slots = await getAvailableSlots({ location: conversation.profile.location });
  const quote = markQuoteStatus(conversation.quote, "accepted", { acceptedAt: new Date().toISOString() });
  store.upsert(conversation.userId, {
    status: STATUS.WAITING_SLOT_SELECTION,
    quote,
    quote_history: updateQuoteHistory(conversation, quote),
    booking: { ...(conversation.booking ?? {}), availableSlots: slots }
  });
  await sendList(conversation.userId, "Great, please choose a preferred date and time from the available slots.", "Select slot", slots.map((slot) => ({ id: `slot:${slot.id}`, title: slot.label, description: conversation.profile.location })));
}

async function handleSlotSelection(conversation, message) {
  const selection = getSelection(message) || normalizeText(getMessageText(message));
  const slotId = selection.replace(/^slot:/i, "");
  const slots = conversation.booking?.availableSlots ?? [];
  const selectedSlot = slots.find((slot) => slot.id === slotId) ?? slots[Number(selection) - 1];
  if (!selectedSlot) return sendText(conversation.userId, "Please select one of the listed booking slots so I can hold it for you.");
  const hold = await holdSlot({ userId: conversation.userId, slot: selectedSlot });
  const paymentReference = createReference(config.PAYMENT_REFERENCE_PREFIX);
  const booking = { ...conversation.booking, selectedSlot, hold, paymentReference, status: "awaiting_deposit" };
  const quote = markQuoteStatus(conversation.quote, "deposit_requested", {
    selectedSlot,
    paymentReference,
    depositRequestedAt: new Date().toISOString()
  });
  store.upsert(conversation.userId, {
    status: STATUS.WAITING_POP,
    quote,
    quote_history: updateQuoteHistory(conversation, quote),
    booking
  });
  await sendText(conversation.userId, `Perfect. I've provisionally held ${selectedSlot.label} for you.`);
  await sendText(conversation.userId, buildPaymentInstructions({ reference: paymentReference, depositAmount: conversation.quote.depositAmount, currencyCode: conversation.quote.currency }));
}

async function handlePopUpload(conversation, media) {
  if (!media) return sendText(conversation.userId, "Please upload your Proof of Payment as a PDF, JPG, or PNG file so we can verify the deposit.");
  if (!isAllowedPopMedia(media)) return sendText(conversation.userId, "I received the file, but POP must be a PDF, JPG, or PNG. Please resend it in one of those formats.");
  const updated = store.upsert(conversation.userId, {
    status: STATUS.POP_RECEIVED,
    quote: markQuoteStatus(conversation.quote, "pop_received", { popReceivedAt: new Date().toISOString() }),
    booking: { ...conversation.booking, status: "pending_bank_clearance", pop: { ...media, receivedAt: new Date().toISOString() } }
  });
  store.upsert(conversation.userId, {
    quote_history: updateQuoteHistory(updated, updated.quote)
  });
  await notifyAdminPop({ conversation: updated, media });
  await sendText(conversation.userId, "Thank you, your POP has been received. Your booking is provisionally confirmed pending final bank clearance.");
}

async function transition(conversation, patch) {
  const updated = updateSession(conversation.userId, patch);
  return renderCurrentScreen(updated);
}

function updateSession(userId, patch) {
  return store.upsert(userId, { ...patch, current_step: deriveStep({ ...store.get(userId), ...patch }) });
}

async function renderCurrentScreen(conversation) {
  switch (conversation.current_screen) {
    case SCREENS.SERVICE_SELECTION:
      return renderServiceSelection(conversation.userId);
    case SCREENS.A_PROPERTY_TYPE:
    case SCREENS.B_PROPERTY_TYPE:
    case SCREENS.C_PROPERTY_TYPE:
      return sendButtons(conversation, "🏡 Property Details\n\nProperty type:", ["House", "Apartment", "Office"]);
    case SCREENS.A_IS_FURNISHED:
    case SCREENS.B_IS_FURNISHED:
    case SCREENS.D_IS_FURNISHED:
      return sendButtons(conversation, "Property status:", ["Empty", "Furnished"]);
    case SCREENS.A_STRUCTURE:
    case SCREENS.D_STRUCTURE:
      return sendButtons(conversation, "Property structure:", ["Single Story", "Double Story", "Other"]);
    case SCREENS.A_BEDROOMS:
      return sendButtons(conversation, "Bedrooms:", ["1", "2", "3", "4", "5+"]);
    case SCREENS.A_BEDROOMS_CUSTOM:
      return sendText(conversation.userId, `${progress(conversation)}\nPlease type the number of bedrooms.`);
    case SCREENS.A_BATHROOMS:
      return sendButtons(conversation, "Bathrooms:", ["1", "2", "3", "4", "5+"]);
    case SCREENS.A_BATHROOMS_CUSTOM:
      return sendText(conversation.userId, `${progress(conversation)}\nPlease type the number of bathrooms.`);
    case SCREENS.A_WINDOWS:
      return sendButtons(conversation, "🪟 Windows\n\nSelect the main window type:", ["Single Volume", "Double Volume", "Full Length"]);
    case SCREENS.A_EXTRA_AREAS:
      return sendList(conversation.userId, `${progress(conversation)}\nExtra areas\n\nReply with all numbers that apply, separated by commas.`, "Extra areas", EXTRA_AREAS.map((title, index) => ({ id: String(index + 1), title })));
    case SCREENS.A_QUARTERS:
      return sendButtons(conversation, "Include Cottage / Flat / Staff Quarters?", ["Yes", "No"]);
    case SCREENS.A_QUARTERS_BEDROOMS:
      return sendText(conversation.userId, `${progress(conversation)}\nHow many bedrooms are in the cottage/flat/staff quarters?`);
    case SCREENS.A_QUARTERS_BATHROOMS:
      return sendText(conversation.userId, `${progress(conversation)}\nHow many bathrooms are included there?`);
    case SCREENS.A_QUARTERS_LIVING:
      return sendButtons(conversation, "Is a living/dining area included?", ["Yes", "No"]);
    case SCREENS.A_UPHOLSTERY_ADDONS:
      await sendText(conversation.userId, sectionSummary(conversation));
      return sendButtons(conversation, "Add carpet or upholstery cleaning?", ["Yes", "No"]);
    case SCREENS.B_ITEM_SELECTION:
      return sendList(conversation.userId, `${progress(conversation)}\nWhat requires cleaning?\n\nReply with all numbers that apply, separated by commas.`, "Items", UPHOLSTERY_ITEMS.map((title, index) => ({ id: String(index + 1), title })));
    case SCREENS.B_FITTED_ROOMS:
      return sendList(conversation.userId, "Fitted carpet locations\n\nReply with all numbers that apply.", "Locations", FITTED_LOCATIONS.map((title, index) => ({ id: String(index + 1), title })));
    case SCREENS.B_LOOSE_DETAILS:
      return sendText(conversation.userId, "Loose carpet details: please type Persian count and standard count. Example: Persian 1, Standard 2");
    case SCREENS.B_COUCH_TYPE:
      return sendButtons(conversation, "Couch configuration:", ["L Shape", "U Shape", "Sleeper", "Standard"]);
    case SCREENS.B_COUCH_SEATS:
      return sendButtons(conversation, "How many seats?", ["1", "2", "3", "4+"]);
    case SCREENS.B_MATTRESS_SIZES:
      return sendList(conversation.userId, "Mattress sizes\n\nReply with all numbers that apply.", "Sizes", MATTRESS_SIZES.map((title, index) => ({ id: String(index + 1), title })));
    case SCREENS.B_OTHER_TEXT:
      return sendText(conversation.userId, "Please describe the other item(s) you need cleaned.");
    case SCREENS.C_CONTRACT_TYPE:
      return sendButtons(conversation, "Contract cleaning type:", ["Stay In", "Stay Out"]);
    case SCREENS.C_DAYS_PER_WEEK:
      return sendText(conversation.userId, `${progress(conversation)}\nHow many days per week? Please reply with a number from 1 to 7.`);
    case SCREENS.C_PREFERENCES:
      return sendText(conversation.userId, "Any personal preferences? Example: ironing, child care, office hours, products to avoid. Reply None if not.");
    case SCREENS.D_KNOWS_SQM:
      return sendButtons(conversation, "Do you know the square meterage?", ["Yes", "No"]);
    case SCREENS.D_SQM:
      return sendText(conversation.userId, `${progress(conversation)}\nPlease type the approximate square meterage.`);
    case SCREENS.D_SITE_VISIT_SLOT:
      return sendList(conversation.userId, "No problem. Please choose a site visit slot.", "Site visit", (conversation.site_visit_slots ?? []).map((slot) => ({ id: `slot:${slot.id}`, title: slot.label })));
    case SCREENS.REVIEW:
      return sendInteractiveButtons(conversation.userId, reviewSummary(conversation), [{ id: "edit", title: "Edit" }, { id: "generate_quote", title: "Generate Quote" }]);
    case SCREENS.EDIT_SELECTION:
      return sendList(conversation.userId, "What would you like to edit?", "Edit", ["Service", "Property Type", "Bedrooms", "Bathrooms", "Extra Areas", "Upholstery"].map((title, index) => ({ id: String(index + 1), title })));
    default:
      return renderServiceSelection(conversation.userId);
  }
}

async function renderServiceSelection(userId, prefix = "") {
  return sendList(userId, `${prefix ? `${prefix}\n\n` : ""}🧹 Select Service Required`, "Services", SERVICES.map((service) => ({ id: service.id, title: service.title })));
}

function sendButtons(conversation, body, options) {
  return sendInteractiveButtons(conversation.userId, `${progress(conversation)}\n${body}`, options.map((title) => ({ id: title, title })));
}

function createInitialSession(userId) {
  return {
    userId,
    user_id: userId,
    status: STATUS.WIZARD,
    current_branch: "",
    current_screen: SCREENS.WELCOME,
    current_step: 0,
    total_steps: 0,
    service_required: "",
    property_type: "",
    is_furnished: "",
    property_structure: "",
    bedroom_count: 0,
    bathroom_count: 0,
    window_type: "",
    extra_rooms_list: [],
    quarters_details: { exists: false, bedrooms: 0, bathrooms: 0, living_dining: false },
    upholstery_specs: { fitted_details: [], loose_details: [], couch_specs: {}, mattress_sizes: [], other_text: "" },
    contract_type: "",
    days_per_week: 0,
    personal_preferences: "",
    property_sqm: 0,
    site_visit_booked: false,
    quote_ready: false,
    profile: {},
    quote: null,
    booking: null,
    pendingAdminAction: null,
    quote_history: []
  };
}

function markQuoteStatus(quote, status, patch = {}) {
  if (!quote) return quote;
  return {
    ...quote,
    ...patch,
    status,
    updatedAt: new Date().toISOString()
  };
}

function updateQuoteHistory(conversation, quote) {
  if (!quote) return conversation.quote_history ?? [];
  const history = conversation.quote_history ?? [];
  const index = history.findIndex((item) => item.quoteId === quote.quoteId);
  if (index === -1) return [...history, quote];
  return history.map((item, itemIndex) => (itemIndex === index ? { ...item, ...quote } : item));
}

function deriveStep(session) {
  if (session.current_branch === "BRANCH_A_DEEP_CLEAN") {
    if ([SCREENS.A_PROPERTY_TYPE, SCREENS.A_IS_FURNISHED, SCREENS.A_STRUCTURE].includes(session.current_screen)) return 1;
    if ([SCREENS.A_BEDROOMS, SCREENS.A_BEDROOMS_CUSTOM, SCREENS.A_BATHROOMS, SCREENS.A_BATHROOMS_CUSTOM].includes(session.current_screen)) return 2;
    if ([SCREENS.A_WINDOWS, SCREENS.A_EXTRA_AREAS].includes(session.current_screen)) return 3;
    if ([SCREENS.A_QUARTERS, SCREENS.A_QUARTERS_BEDROOMS, SCREENS.A_QUARTERS_BATHROOMS, SCREENS.A_QUARTERS_LIVING].includes(session.current_screen)) return 4;
    if ([SCREENS.A_UPHOLSTERY_ADDONS, SCREENS.B_ITEM_SELECTION, SCREENS.B_FITTED_ROOMS, SCREENS.B_LOOSE_DETAILS, SCREENS.B_COUCH_TYPE, SCREENS.B_COUCH_SEATS, SCREENS.B_MATTRESS_SIZES, SCREENS.B_OTHER_TEXT].includes(session.current_screen)) return 5;
  }
  if (session.current_branch === "BRANCH_B_CARPETS") return session.current_screen === SCREENS.REVIEW ? 3 : session.current_screen === SCREENS.B_ITEM_SELECTION ? 2 : 1;
  if (session.current_branch === "BRANCH_C_DOMESTIC") return [SCREENS.C_DAYS_PER_WEEK, SCREENS.C_PREFERENCES].includes(session.current_screen) ? 3 : 1;
  if (session.current_branch === "BRANCH_D_COMMERCIAL") return [SCREENS.D_SQM, SCREENS.D_SITE_VISIT_SLOT].includes(session.current_screen) ? 3 : 1;
  return session.current_step ?? 0;
}

function progress(conversation) {
  if (!conversation.total_steps) return "";
  return `Step ${conversation.current_step || 1} / ${conversation.total_steps}\n`;
}

function nextUpholsteryScreen(specs) {
  const selected = specs.selected_items ?? [];
  if (selected.includes("Fitted Carpet") && !specs.fitted_details?.length) return SCREENS.B_FITTED_ROOMS;
  if (selected.includes("Loose Carpet") && !specs.loose_details?.length) return SCREENS.B_LOOSE_DETAILS;
  if (selected.includes("Couch") && !specs.couch_specs?.configuration) return SCREENS.B_COUCH_TYPE;
  if (selected.includes("Couch") && !specs.couch_specs?.seats) return SCREENS.B_COUCH_SEATS;
  if (selected.includes("Mattress") && !specs.mattress_sizes?.length) return SCREENS.B_MATTRESS_SIZES;
  if (selected.includes("Other") && !specs.other_text) return SCREENS.B_OTHER_TEXT;
  return SCREENS.REVIEW;
}

function buildLegacyProfile(conversation) {
  const addOns = [
    ...(conversation.extra_rooms_list ?? []),
    ...(conversation.upholstery_specs?.selected_items ?? [])
  ].join(", ") || "None";
  return {
    serviceRequired: conversation.service_required,
    propertySize: conversation.property_sqm
      ? `${conversation.property_sqm} sqm`
      : `${conversation.bedroom_count || 0} bedrooms, ${conversation.bathroom_count || 0} bathrooms`,
    addOns,
    location: conversation.location || conversation.personal_preferences || "To confirm",
    branch: conversation.current_branch,
    wizard: buildCrmSession(conversation)
  };
}

function buildCrmSession(conversation) {
  const {
    user_id, current_branch, current_screen, current_step, total_steps, service_required,
    property_type, is_furnished, property_structure, bedroom_count, bathroom_count,
    window_type, extra_rooms_list, quarters_details, upholstery_specs, contract_type,
    days_per_week, personal_preferences, property_sqm, site_visit_booked, quote_ready
  } = conversation;
  return {
    user_id, current_branch, current_screen, current_step, total_steps, service_required,
    property_type, is_furnished, property_structure, bedroom_count, bathroom_count,
    window_type, extra_rooms_list, quarters_details, upholstery_specs, contract_type,
    days_per_week, personal_preferences, property_sqm, site_visit_booked, quote_ready
  };
}

function reviewSummary(conversation) {
  return [
    "📋 Review Details",
    "",
    `Service: ${conversation.service_required || "-"}`,
    `Property: ${conversation.property_type || "-"} (${conversation.is_furnished || "-"})`,
    `Structure: ${conversation.property_structure || "-"}`,
    `Bedrooms/Bathrooms: ${conversation.bedroom_count || 0} / ${conversation.bathroom_count || 0}`,
    `Windows: ${conversation.window_type || "-"}`,
    `Extra areas: ${(conversation.extra_rooms_list ?? []).join(", ") || "None"}`,
    `Upholstery: ${(conversation.upholstery_specs?.selected_items ?? []).join(", ") || "None"}`,
    `Contract: ${conversation.contract_type || "N/A"}`,
    `Sqm: ${conversation.property_sqm || "N/A"}`,
    "",
    "Choose Edit to change an answer, or Generate Quote to send it for approval."
  ].join("\n");
}

function sectionSummary(conversation) {
  return [
    "Saved so far:",
    `Property: ${conversation.property_type}, ${conversation.is_furnished}, ${conversation.property_structure}`,
    `Size: ${conversation.bedroom_count || 0} bedrooms, ${conversation.bathroom_count || 0} bathrooms`,
    `Windows: ${conversation.window_type || "-"}`
  ].join("\n");
}

function formatCustomerQuote(quote) {
  const addOns = quote.addOns.length ? quote.addOns.map((item) => item.name).join(", ") : "No add-ons";
  return [
    "Your cleaning quote is ready.",
    "",
    `Service: ${quote.service}`,
    `Add-ons: ${addOns}`,
    `Estimated total: ${currency(quote.total, quote.currency)}`,
    `50% deposit to book: ${currency(quote.depositAmount, quote.currency)}`,
    "",
    "Reply \"Accept\" to continue to booking, or ask a question and our team will assist."
  ].join("\n");
}

function getMessageText(message) {
  if (message.type === "text") return message.text?.body ?? "";
  return getSelection(message) ?? "";
}

function getSelection(message) {
  if (message.type !== "interactive") return null;
  return message.interactive?.button_reply?.id ?? message.interactive?.list_reply?.id ?? message.interactive?.button_reply?.title ?? message.interactive?.list_reply?.title ?? null;
}

function findBySelection(items, value = "") {
  const text = normalizeText(String(value)).toLowerCase();
  return items.find((item, index) => text === item.id?.toLowerCase() || text === String(index + 1) || text.includes(item.title.toLowerCase().replace(/^\d+\.\s*/, "")));
}

function findOption(options, value = "") {
  const text = normalizeText(String(value)).toLowerCase();
  return options.find((option, index) => text === option.toLowerCase() || text === String(index + 1) || text.includes(option.toLowerCase()));
}

function parseMultiSelect(value = "", options = []) {
  const text = normalizeText(String(value));
  const numberSelections = text.split(/[,\s]+/).map((item) => Number(item)).filter(Boolean);
  const selected = new Set();
  for (const number of numberSelections) {
    if (options[number - 1]) selected.add(options[number - 1]);
  }
  for (const option of options) {
    if (text.toLowerCase().includes(option.toLowerCase())) selected.add(option);
  }
  return [...selected];
}

function isYes(value = "") {
  return /^(yes|y|1|true|sure)$/i.test(normalizeText(String(value)));
}

function isRestart(text = "") {
  return /^(start|restart|new quote|quote)$/i.test(normalizeText(text));
}

function isCancelRequest(text = "") {
  return /^(cancel|stop|decline)$/i.test(normalizeText(text));
}

function isTimedOut(conversation) {
  if (!conversation.updatedAt || conversation.status !== STATUS.WIZARD) return false;
  return Date.now() - new Date(conversation.updatedAt).getTime() > SESSION_TIMEOUT_MS;
}
