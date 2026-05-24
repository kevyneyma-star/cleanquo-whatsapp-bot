export function normalizeText(value = "") {
  return value.trim().replace(/\s+/g, " ");
}

export function lower(value = "") {
  return normalizeText(value).toLowerCase();
}

export function isAffirmative(value = "") {
  return /^(yes|yebo|yeah|yep|accept|accepted|i accept|go ahead|proceed|book|confirm)$/i.test(
    normalizeText(value)
  );
}

export function isNegative(value = "") {
  return /^(no|nope|not now|decline|cancel|stop)$/i.test(normalizeText(value));
}

export function currency(amount, code = "ZAR") {
  return new Intl.NumberFormat("en-ZA", {
    style: "currency",
    currency: code,
    maximumFractionDigits: 0
  }).format(amount);
}

export function numberedList(items) {
  return items.map((item, index) => `${index + 1}. ${item}`).join("\n");
}
