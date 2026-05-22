import { config } from "../config.js";

const BASE_PRICES = {
  "deep cleaning": 950,
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

export function calculateQuote(profile) {
  const service = profile.serviceRequired?.toLowerCase() ?? "standard cleaning";
  const base = BASE_PRICES[service] ?? BASE_PRICES["standard cleaning"];
  const propertyMultiplier = derivePropertyMultiplier(profile.propertySize);
  const addOns = parseAddOns(profile.addOns);
  const addOnTotal = addOns.reduce((sum, addOn) => sum + addOn.price, 0);
  const subtotal = Math.round(base * propertyMultiplier + addOnTotal);
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

function derivePropertyMultiplier(propertySize = "") {
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

function parseAddOns(addOnsText = "") {
  const text = addOnsText.toLowerCase();
  if (/^(none|no|n\/a|na)$/i.test(text.trim())) return [];

  return Object.entries(ADD_ON_PRICES)
    .filter(([keyword]) => text.includes(keyword))
    .map(([name, price]) => ({ name, price }));
}
