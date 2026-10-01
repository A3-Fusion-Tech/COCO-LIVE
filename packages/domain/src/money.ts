import { invalid } from "./errors.ts";

export type Currency = "INR";
export interface Money {
  amountPaise: number;
  currency: Currency;
}
export interface Quantity {
  value: string;
  unit: string;
}

export const inr = (amountPaise: number): Money => {
  if (!Number.isSafeInteger(amountPaise) || amountPaise < 0) {
    throw invalid("INVALID_MONEY", "Money must be a non-negative integer number of paise");
  }
  return { amountPaise, currency: "INR" };
};

const DECIMAL = /^\d+(\.\d{1,3})?$/;

/** Parse a non-negative decimal string (max 3 fraction digits) to thousandths. */
export function toMilli(value: string): bigint {
  if (typeof value !== "string" || !DECIMAL.test(value)) {
    throw invalid("INVALID_QUANTITY", `Quantity must be a decimal string with up to 3 fraction digits: ${String(value)}`);
  }
  const [whole = "0", frac = ""] = value.split(".");
  return BigInt(whole) * 1000n + BigInt(frac.padEnd(3, "0"));
}

export function fromMilli(milli: bigint): string {
  const whole = milli / 1000n;
  const frac = (milli % 1000n).toString().padStart(3, "0").replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : `${whole}`;
}

export const compareQuantity = (a: string, b: string): number => {
  const x = toMilli(a);
  const y = toMilli(b);
  return x < y ? -1 : x > y ? 1 : 0;
};
export const addQuantity = (a: string, b: string) => fromMilli(toMilli(a) + toMilli(b));
export const subtractQuantity = (a: string, b: string): string => {
  const r = toMilli(a) - toMilli(b);
  if (r < 0n) throw invalid("NEGATIVE_QUANTITY", "Quantity cannot become negative");
  return fromMilli(r);
};

/** Estimated total in paise, rounded half-up; unit price per single unit. */
export function estimateTotalPaise(quantity: string, unitPricePaise: number): number {
  const milli = toMilli(quantity);
  const total = (milli * BigInt(unitPricePaise) + 500n) / 1000n;
  if (total > BigInt(Number.MAX_SAFE_INTEGER)) throw invalid("TOTAL_TOO_LARGE", "Total exceeds supported range");
  return Number(total);
}
