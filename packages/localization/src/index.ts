export type Locale = "en" | "ta";
export const SUPPORTED_LOCALES: Locale[] = ["en", "ta"];

export const CATALOG = {
  en: {
    "price.not_offer": "Reference prices are not guaranteed offers. Confirm with a buyer before making a trade decision.",
    "price.insufficient": "No current verified range; showing the latest official market observation.",
    "price.limited_evidence": "Evidence is limited. Confirm with a buyer before making a trade decision.",
    "price.reported_at": "Reported at",
    "price.last_reported": "Last reported for",
    "price.stale": "Stale",
    "price.aging": "Aging",
    "price.current": "Current",
    "price.msp_note": "Minimum Support Price is a policy reference, not a market quote.",
    "price.confidence.HIGH": "High confidence",
    "price.confidence.MEDIUM": "Medium confidence",
    "price.confidence.LOW": "Low confidence",
    "price.low": "Low",
    "price.reference": "Reference",
    "price.high": "High",
    "price.evidence": "Evidence",
    "price.title": "Coconut prices — Pollachi belt",
    "unit.NUT": "nut", "unit.KG": "kg", "unit.QUINTAL": "quintal", "unit.TONNE": "tonne",
    "stage.FARM_GATE": "Farm gate", "stage.REGULATED_MARKET": "Regulated market", "stage.WHOLESALE": "Wholesale",
    "stage.PROCESSOR_PURCHASE": "Processor purchase", "stage.RETAIL": "Retail",
    "term.EX_FARM": "Ex-farm", "term.DELIVERED": "Delivered", "term.AT_MARKET": "At market", "term.EX_WAREHOUSE": "Ex-warehouse",
    "error.offer_expired": "This offer has expired.",
    "error.not_found": "Not found.",
    "error.forbidden": "You are not permitted to do this.",
    "error.unauthenticated": "Please sign in.",
    "error.rate_limited": "Too many requests. Try again later.",
    "error.otp_invalid": "The code is invalid or expired.",
    "error.validation_failed": "Some fields are invalid.",
    "error.conflict": "The request conflicts with the current state.",
    "claim.MOBILE_CONTROL": "Mobile number verified",
    "claim.PERSON_IDENTITY": "Identity documents checked",
    "claim.ORGANIZATION_EXISTENCE": "Organization documents checked",
    "claim.PRICE_CONTRIBUTOR_SCOPE": "Approved price contributor",
    "claim.LOT_STOCK": "Stock checked",
  },
  ta: {
    "price.not_offer": "குறிப்பு விலைகள் உத்தரவாதமான சலுகைகள் அல்ல. வர்த்தக முடிவுக்கு முன் வாங்குபவருடன் உறுதிசெய்யவும்.",
    "price.insufficient": "தற்போதைய சரிபார்க்கப்பட்ட விலை வரம்பு இல்லை; சமீபத்திய அதிகாரபூர்வ சந்தை பதிவு காட்டப்படுகிறது.",
    "price.limited_evidence": "ஆதாரம் குறைவு. வர்த்தக முடிவுக்கு முன் வாங்குபவருடன் உறுதிசெய்யவும்.",
    "price.reported_at": "பதிவான நேரம்",
    "price.last_reported": "கடைசியாகப் பதிவான நாள்",
    "price.stale": "பழையது",
    "price.aging": "சற்றுப் பழையது",
    "price.current": "தற்போதையது",
    "price.msp_note": "குறைந்தபட்ச ஆதரவு விலை ஒரு கொள்கை குறிப்பு; சந்தை விலை அல்ல.",
    "price.confidence.HIGH": "உயர் நம்பகத்தன்மை",
    "price.confidence.MEDIUM": "நடுத்தர நம்பகத்தன்மை",
    "price.confidence.LOW": "குறைந்த நம்பகத்தன்மை",
    "price.low": "குறைந்த",
    "price.reference": "குறிப்பு",
    "price.high": "அதிக",
    "price.evidence": "ஆதாரம்",
    "price.title": "தேங்காய் விலை — பொள்ளாச்சி பகுதி",
    "unit.NUT": "காய்", "unit.KG": "கிலோ", "unit.QUINTAL": "குவிண்டால்", "unit.TONNE": "டன்",
    "stage.FARM_GATE": "பண்ணை வாசல்", "stage.REGULATED_MARKET": "ஒழுங்குமுறை சந்தை", "stage.WHOLESALE": "மொத்த விற்பனை",
    "stage.PROCESSOR_PURCHASE": "ஆலை கொள்முதல்", "stage.RETAIL": "சில்லறை",
    "term.EX_FARM": "பண்ணையில்", "term.DELIVERED": "விநியோகத்துடன்", "term.AT_MARKET": "சந்தையில்", "term.EX_WAREHOUSE": "கிடங்கில்",
    "error.offer_expired": "இந்த சலுகை காலாவதியானது.",
    "error.not_found": "கிடைக்கவில்லை.",
    "error.forbidden": "இதைச் செய்ய உங்களுக்கு அனுமதி இல்லை.",
    "error.unauthenticated": "உள்நுழையவும்.",
    "error.rate_limited": "அதிக கோரிக்கைகள். பின்னர் முயற்சிக்கவும்.",
    "error.otp_invalid": "குறியீடு தவறானது அல்லது காலாவதியானது.",
    "error.validation_failed": "சில புலங்கள் தவறானவை.",
    "error.conflict": "கோரிக்கை தற்போதைய நிலையுடன் முரண்படுகிறது.",
    "claim.MOBILE_CONTROL": "கைபேசி எண் சரிபார்க்கப்பட்டது",
    "claim.PERSON_IDENTITY": "அடையாள ஆவணங்கள் சரிபார்க்கப்பட்டன",
    "claim.ORGANIZATION_EXISTENCE": "நிறுவன ஆவணங்கள் சரிபார்க்கப்பட்டன",
    "claim.PRICE_CONTRIBUTOR_SCOPE": "அங்கீகரிக்கப்பட்ட விலை பங்களிப்பாளர்",
    "claim.LOT_STOCK": "இருப்பு சரிபார்க்கப்பட்டது",
  },
} as const satisfies Record<Locale, Record<string, string>>;

export type MessageKey = keyof (typeof CATALOG)["en"];

export function t(locale: Locale, key: string): string {
  const cat = CATALOG[locale] as Record<string, string>;
  return cat[key] ?? (CATALOG.en as Record<string, string>)[key] ?? key;
}

export function parseLocale(header: string | null | undefined, query?: string | null): Locale {
  const pick = (query ?? header ?? "").toLowerCase();
  return pick.startsWith("ta") ? "ta" : "en";
}

export function formatMoney(paise: number, locale: Locale): string {
  return new Intl.NumberFormat(locale === "ta" ? "ta-IN" : "en-IN", { style: "currency", currency: "INR", minimumFractionDigits: paise % 100 ? 2 : 0 }).format(paise / 100);
}

export function formatDateTime(iso: string, locale: Locale): string {
  return new Intl.DateTimeFormat(locale === "ta" ? "ta-IN" : "en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" }).format(new Date(iso));
}

/** Catalog parity check used by tests: both locales must define identical keys. */
export function missingKeys(): { locale: Locale; keys: string[] }[] {
  const en = Object.keys(CATALOG.en);
  const ta = Object.keys(CATALOG.ta);
  return [
    { locale: "ta", keys: en.filter((k) => !ta.includes(k)) },
    { locale: "en", keys: ta.filter((k) => !en.includes(k)) },
  ];
}
