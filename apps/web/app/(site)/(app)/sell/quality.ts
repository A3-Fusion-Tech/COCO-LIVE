/** Quality attributes each product needs before a lot can be published (`requiredAttributes` in the catalog). */
export const QUALITY_FIELDS: Record<string, { name: string; labelKey: string; value: string }[]> = {
  prod_mature_coconut: [{ name: "husk", labelKey: "sell.husk", value: "WITH_HUSK" }],
  prod_tender_coconut: [{ name: "size", labelKey: "sell.size", value: "MEDIUM" }],
  prod_milling_copra: [{ name: "moisturePercent", labelKey: "sell.moisture", value: "6" }],
  prod_ball_copra: [{ name: "moisturePercent", labelKey: "sell.moisture", value: "7" }],
};
