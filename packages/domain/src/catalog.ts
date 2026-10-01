export type ProductId = "prod_mature_coconut" | "prod_tender_coconut" | "prod_milling_copra" | "prod_ball_copra";
export type Unit = "NUT" | "KG" | "QUINTAL" | "TONNE";
export type MarketStage = "FARM_GATE" | "REGULATED_MARKET" | "WHOLESALE" | "PROCESSOR_PURCHASE" | "RETAIL";
export type TradeTerm = "EX_FARM" | "DELIVERED" | "AT_MARKET" | "EX_WAREHOUSE";

export interface Product {
  productId: ProductId;
  name: { en: string; ta: string };
  units: Unit[];
  stages: MarketStage[];
  /** Attributes a sell lot must carry before activation. */
  requiredAttributes: string[];
  /** Incompatible products are never aggregated (distinct IDs always differ). */
  enabled: boolean;
}

export const PRODUCTS: Record<ProductId, Product> = {
  prod_mature_coconut: {
    productId: "prod_mature_coconut",
    name: { en: "Mature coconut", ta: "முற்றிய தேங்காய்" },
    units: ["NUT", "KG", "QUINTAL", "TONNE"],
    stages: ["FARM_GATE", "REGULATED_MARKET", "WHOLESALE", "PROCESSOR_PURCHASE", "RETAIL"],
    requiredAttributes: ["husk"],
    enabled: true,
  },
  prod_tender_coconut: {
    productId: "prod_tender_coconut",
    name: { en: "Tender coconut", ta: "இளநீர்" },
    units: ["NUT"],
    stages: ["FARM_GATE", "WHOLESALE", "RETAIL"],
    requiredAttributes: ["size"],
    enabled: true,
  },
  prod_milling_copra: {
    productId: "prod_milling_copra",
    name: { en: "Milling copra", ta: "கொப்பரை (ஆலை)" },
    units: ["KG", "QUINTAL", "TONNE"],
    stages: ["REGULATED_MARKET", "WHOLESALE", "PROCESSOR_PURCHASE"],
    requiredAttributes: ["moisturePercent"],
    enabled: true,
  },
  prod_ball_copra: {
    productId: "prod_ball_copra",
    name: { en: "Ball copra", ta: "உருண்டைக் கொப்பரை" },
    units: ["KG", "QUINTAL", "TONNE"],
    stages: ["REGULATED_MARKET", "WHOLESALE", "PROCESSOR_PURCHASE", "RETAIL"],
    requiredAttributes: ["moisturePercent"],
    enabled: true,
  },
};

export interface Market {
  marketId: string;
  name: { en: string; ta: string };
  areaId: string;
  lat: number;
  lon: number;
}

export const MARKETS: Record<string, Market> = {
  market_pollachi: { marketId: "market_pollachi", name: { en: "Pollachi", ta: "பொள்ளாச்சி" }, areaId: "area_pollachi_belt", lat: 10.658, lon: 77.008 },
  market_anaimalai: { marketId: "market_anaimalai", name: { en: "Anaimalai", ta: "ஆனைமலை" }, areaId: "area_pollachi_belt", lat: 10.5833, lon: 76.9333 },
  market_kinathukadavu: { marketId: "market_kinathukadavu", name: { en: "Kinathukadavu", ta: "கிணத்துக்கடவு" }, areaId: "area_pollachi_belt", lat: 10.8167, lon: 77.0 },
  market_udumalpet: { marketId: "market_udumalpet", name: { en: "Udumalpet", ta: "உடுமலைப்பேட்டை" }, areaId: "area_pollachi_belt", lat: 10.5833, lon: 77.25 },
  market_sulur: { marketId: "market_sulur", name: { en: "Sulur", ta: "சூலூர்" }, areaId: "area_pollachi_belt", lat: 11.0167, lon: 77.1167 },
  market_palladam: { marketId: "market_palladam", name: { en: "Palladam", ta: "பல்லடம்" }, areaId: "area_pollachi_belt", lat: 10.9833, lon: 77.2833 },
};

/** Source commodity names (AGMARKNET) → canonical product. Anything else goes to the mapping queue. */
export const SOURCE_COMMODITY_MAP: Record<string, ProductId> = {
  coconut: "prod_mature_coconut",
  "copra": "prod_milling_copra",
  "coconut (tender)": "prod_tender_coconut",
  "ball copra": "prod_ball_copra",
};

/** Source market names → canonical market. */
export const SOURCE_MARKET_MAP: Record<string, string> = {
  pollachi: "market_pollachi",
  anaimalai: "market_anaimalai",
  kinathukadavu: "market_kinathukadavu",
  udumalpet: "market_udumalpet",
  sulur: "market_sulur",
  palladam: "market_palladam",
};

export const SOURCE_UNIT_MAP: Record<string, Unit> = {
  "rs./quintal": "QUINTAL",
  "rs/quintal": "QUINTAL",
  "rs./kg": "KG",
  "rs./nut": "NUT",
};

export function haversineKm(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(h));
}
