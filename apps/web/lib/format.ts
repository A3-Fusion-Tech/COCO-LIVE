import { formatDateTime, formatMoney, type Locale } from "@livecoco/localization";
import { invalidInput } from "./api/errors.ts";

export const money = (locale: Locale, paise: number) => formatMoney(paise, locale);
export const when = (locale: Locale, iso: string) => formatDateTime(iso, locale);

/** Rupees as typed ("30", "30.5") to integer paise, without floating-point arithmetic. */
export function toPaise(v: string): number {
  const m = /^\s*(\d+)(?:\.(\d{1,2}))?\s*$/.exec(v);
  if (!m) throw invalidInput(`Invalid amount: ${v}`);
  return Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0"));
}

/** Paise to the rupee string a form field shows ("30", "30.5"). */
export const rupees = (paise: number) => String(paise / 100);

/** India Standard Time. The users are in Tamil Nadu and forms are handled on the server, whose zone may differ. */
const IST_OFFSET = "+05:30";

/** A `datetime-local` value ("2026-10-28T09:30"), read as Indian time, to an ISO instant. */
export function localIso(v: string): string {
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})(:\d{2})?$/.exec(v.trim());
  if (!m) throw invalidInput(`Invalid date and time: ${v}`);
  return new Date(`${m[1]}T${m[2]}${m[3] ?? ":00"}${IST_OFFSET}`).toISOString();
}

export const hoursFromNow = (n: number, now = Date.now()) => new Date(now + n * 3_600_000).toISOString();
export const csv = (v: string) => v.split(",").map((x) => x.trim()).filter(Boolean);
