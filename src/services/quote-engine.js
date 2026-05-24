import { config } from "../config.js";

const BASE_PRICES = {
  "deep cleaning": 950,
  "move in / out cleaning": 1250,
  "move-in/out cleaning": 1250,
  "move in cleaning": 1250,
  "move out cleaning": 1250,
  "post-construction": 1800,
  "post construction": 1800,
  "standard cleaning": 650
};

const ADD_ON_PRICES = {
  carpet: 350,
  windows: 300,
  window: 300,
  upholstery: 450,
  oven: 250,
  fridge: 220
};

export function calculateQuote(profile, session = {}) {
  const service = profile.serviceRequired?.toLowerCase() ?? "standard cleaning";
  const base = BASE_PRICES[service] ?? BASE_PRICES["standard cleaning"];
  const propertyMultiplier = derivePropertyMultiplier(profile.propertySize, session);
  const addOns = parseAddOns(profile.addOns);
  const addOnTotal = addOns.reduce((sum, addOn) => sum + addOn.price, 0) + deriveWizardAddOnTotal(session);
  const subtotal = Math.round(base * propertyMultiplier + addOnTotal + deriveCommercialTotal(session));
  const depositAmount = Math.ceil(subtotal * 0.5);

  return {
    currency: config.QUOTE_CURRENCY,
    service,
    base,
    propertyMultiplier,
    addOns,
    subtotal,
    total: subtotal,
    depositAmount,
    validUntil: new Date(
      Date.now() + config.QUOTE_VALID_HOURS * 60 * 60 * 1000
    ).toISOString()
  };
}

function derivePropertyMultiplier(propertySize = "", session = {}) {
  if (Number(session.property_sqm) > 0) {
    const sqm = Number(session.property_sqm);
    if (sqm <= 80) return 1;
    if (sqm <= 180) return 1.55;
    if (sqm <= 350) return 2.4;
    return 3.5;
  }

  if (Number(session.bedroom_count) || Number(session.bathroom_count)) {
    const roomsScore = Number(session.bedroom_count ?? 0) + Number(session.bathroom_count ?? 0) * 0.5;
    if (roomsScore <= 2) return 1;
    if (roomsScore <= 4) return 1.35;
    if (roomsScore <= 6) return 1.7;
    return 2.15;
  }

  const text = propertySize.toLowerCase();
  const bedrooms = Number(text.match(/(\d+)\s*(bed|bedroom|br)/)?.[1] ?? 0);
  const bathrooms = Number(text.match(/(\d+)\s*(bath|bathroom)/)?.[1] ?? 0);
  const squareMeters = Number(text.match(/(\d+)\s*(sqm|m2|square)/)?.[1] ?? 0);

  if (squareMeters > 0) {
    if (squareMeters <= 60) return 1;
    if (squareMeters <= 120) return 1.35;
    if (squareMeters <= 220) return 1.8;
    return 2.4;
  }

  const roomsScore = bedrooms + bathrooms * 0.5;
  if (roomsScore <= 2) return 1;
  if (roomsScore <= 4) return 1.35;
  if (roomsScore <= 6) return 1.7;
  return 2.15;
}

function deriveWizardAddOnTotal(session = {}) {
  let total = 0;
  total += (session.extra_rooms_list?.length ?? 0) * 120;
  if (session.window_type === "Double Volume") total += 350;
  if (session.window_type === "Full Length") total += 250;
  if (session.quarters_details?.exists) {
    total += 450 + Number(session.quarters_details.bedrooms ?? 0) * 150 + Number(session.quarters_details.bathrooms ?? 0) * 120;
    if (session.quarters_details.living_dining) total += 180;
  }
  const upholstery = session.upholstery_specs ?? {};
  total += (upholstery.fitted_details?.length ?? 0) * 220;
  total += (upholstery.loose_details?.length ?? 0) * 300;
  if (upholstery.couch_specs?.configuration) total += upholstery.couch_specs.seats === "4+" ? 650 : 450;
  total += (upholstery.mattress_sizes?.length ?? 0) * 280;
  if (upholstery.other_text) total += 250;
  return total;
}

function deriveCommercialTotal(session = {}) {
  if (session.current_branch === "BRANCH_C_DOMESTIC") {
    return Number(session.days_per_week ?? 0) * 250;
  }
  if (session.current_branch === "BRANCH_D_COMMERCIAL" && !session.property_sqm && session.site_visit_booked) {
    return 0;
  }
  return 0;
}

function parseAddOns(addOnsText = "") {
  const text = addOnsText.toLowerCase();
  if (/^(none|no|n\/a|na)$/i.test(text.trim())) return [];

  return Object.entries(ADD_ON_PRICES)
    .filter(([keyword]) => text.includes(keyword))
    .map(([name, price]) => ({ name, price }));
}
