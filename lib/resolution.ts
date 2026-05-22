const RESHIP_COST = 65;
const PARTIAL_RESHIP_COST = 30;
const EXTRA_MEAT_OR_CHEESE_COST = 10;
const EXTRA_ACCOMPANIMENT_COST = 6;

export type ResolutionSource = "db" | "tags" | "derived" | null;

export type ParsedResolution = {
  label: string | null;
  normalized: string | null;
  cost: number;
  hasAppliedResolution: boolean;
  components: string[];
  source: ResolutionSource;
};

function unique(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

function hasAny(text: string, patterns: string[]): boolean {
  return patterns.some((pattern) => text.includes(pattern));
}

export function parseResolution(
  resolutionApplied: string | null | undefined,
  tags: string | null | undefined,
): ParsedResolution {
  const explicit = (resolutionApplied ?? "").trim();
  const fallback = (tags ?? "").trim();
  const raw = explicit || fallback;

  if (!raw) {
    return {
      label: null,
      normalized: null,
      cost: 0,
      hasAppliedResolution: false,
      components: [],
      source: null,
    };
  }

  const text = raw.toLowerCase();
  const source: ResolutionSource = explicit ? "db" : "tags";
  const components: string[] = [];

  const hasFullReship = hasAny(text, [
    "full reship",
    "reship full",
    "complimentary reship",
  ]) || (text.includes("reship") && !text.includes("partial"));
  const hasPartialReship = hasAny(text, ["partial reship"]);
  const hasFullRefund = hasAny(text, [
    "full refund",
    "refund duplicate",
    "refund order::full refund",
  ]);
  const hasExtraCheese = hasAny(text, [
    "extra cheese",
    "free_cheese",
    "free cheese",
    "refund10_freecheese",
    "comp cheese",
  ]);
  const hasExtraMeat = hasAny(text, [
    "extra meat",
    "free_meat",
    "free meat",
    "refund10_freemeat",
    "comp meat",
  ]);
  const hasExtraAccompaniment = hasAny(text, [
    "extra accompaniment",
    "extra acc",
    "free_acc",
    "free acc",
    "refund10_freeacc",
  ]);
  const hasTenOff = hasAny(text, [
    "$10",
    "10 off",
    "amount $10",
    "credit next box::amount $10",
    "refund10_",
  ]);
  const hasCredit = text.includes("credit");
  const hasRefund = text.includes("refund");
  const hasAppliedCredit = hasAny(text, ["applied credit", "credit applied", "store credit"]);
  const hasCancelSub = hasAny(text, ["cancel sub", "cancelled sub", "subscription cancel"]);

  if (hasFullReship) components.push("Full Reship");
  if (hasPartialReship) components.push("Partial Reship");
  if (hasFullRefund) components.push("Full Refund");
  if (hasTenOff && !hasFullRefund && !hasFullReship && !hasPartialReship) {
    components.push("$10 Off");
  }
  if (hasExtraCheese) components.push("Extra Cheese");
  if (hasExtraMeat) components.push("Extra Meat");
  if (hasExtraAccompaniment) components.push("Extra Accompaniment");
  if (!components.length && hasCredit) components.push("Credit");
  if (!components.length && hasRefund) components.push("Refund");

  let normalized: string | null = null;
  let cost = 0;

  if (hasFullReship) {
    normalized = "full reship";
    cost = RESHIP_COST;
  } else if (hasPartialReship) {
    normalized = "partial reship";
    cost = PARTIAL_RESHIP_COST;
  } else if (hasFullRefund) {
    normalized = "full refund";
    cost = RESHIP_COST;
  } else if (hasTenOff && hasExtraCheese) {
    normalized = "$10 off + extra cheese";
    cost = 20;
  } else if (hasTenOff && hasExtraMeat) {
    normalized = "$10 off + extra meat";
    cost = 20;
  } else if (hasTenOff && hasExtraAccompaniment) {
    normalized = "$10 off + extra accompaniment";
    cost = 16;
  } else if (hasExtraCheese) {
    normalized = "extra cheese";
    cost = EXTRA_MEAT_OR_CHEESE_COST;
  } else if (hasExtraMeat) {
    normalized = "extra meat";
    cost = EXTRA_MEAT_OR_CHEESE_COST;
  } else if (hasExtraAccompaniment) {
    normalized = "extra accompaniment";
    cost = EXTRA_ACCOMPANIMENT_COST;
  } else {
    const amountMatch = text.match(/\$(\d+(?:\.\d+)?)/);
    if (amountMatch) {
      const amount = Number.parseFloat(amountMatch[1]);
      normalized = hasRefund ? "refund" : hasCredit ? "credit" : "manual adjustment";
      cost = Number.isFinite(amount) ? amount : 0;
    } else if (hasAppliedCredit) {
      normalized = "applied credit";
      cost = 10;
    } else if (hasRefund) {
      normalized = "refund";
      cost = PARTIAL_RESHIP_COST;
    } else if (hasCredit) {
      normalized = "credit";
      cost = 10;
    } else if (hasCancelSub) {
      normalized = "cancel subscription";
      cost = 0;
    }
  }

  const label = normalized
    ? unique(components).join(" + ") || normalized
    : explicit || fallback;

  return {
    label,
    normalized,
    cost,
    hasAppliedResolution: Boolean(normalized || explicit),
    components: unique(components),
    source,
  };
}
