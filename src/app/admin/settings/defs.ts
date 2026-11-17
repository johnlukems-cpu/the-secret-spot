/** Typed definitions of editable settings (validation per key). */
export const SETTING_DEFS: Record<string, { label: string; type: "number" | "boolean" | "text" | "longtext"; min?: number; max?: number; group: string }> = {
  deposit_ready_pct: { label: "Aanbetaling ready-stock (%)", type: "number", min: 0, max: 100, group: "Betaling" },
  deposit_preorder_pct: { label: "Aanbetaling pre-order (%)", type: "number", min: 0, max: 100, group: "Betaling" },
  deposit_min_amount: { label: "Minimale aanbetaling (SRD)", type: "number", min: 0, group: "Betaling" },
  deposit_includes_delivery: { label: "Bezorgkosten meetellen in aanbetaling", type: "boolean", group: "Betaling" },
  payment_deadline_hours: { label: "Betaaltermijn aanbetaling (uren)", type: "number", min: 1, max: 720, group: "Betaling" },
  verification_grace_hours: { label: "Extra reserveringstijd na betaalbewijs (uren)", type: "number", min: 1, max: 720, group: "Betaling" },
  quote_validity_hours: { label: "Geldigheid offerte (uren)", type: "number", min: 1, max: 2160, group: "Betaling" },
  payment_disclaimer: { label: "Betaaldisclaimer", type: "longtext", group: "Betaling" },
  cancellation_policy: { label: "Annulerings- en terugbetalingsvoorwaarden", type: "longtext", group: "Voorwaarden" },
  purchasing_weekday: { label: "Inkoopdag (1 = maandag … 7 = zondag)", type: "number", min: 1, max: 7, group: "Inkoop" },
  low_stock_default: { label: "Standaard lage-voorraaddrempel", type: "number", min: 0, group: "Voorraad" },
  store_name: { label: "Winkelnaam", type: "text", group: "Winkel" },
  store_tagline: { label: "Tagline", type: "text", group: "Winkel" },
  store_whatsapp: { label: "WhatsApp-nummer (internationaal, bijv. 5978123456)", type: "text", group: "Winkel" },
  store_email: { label: "Contact e-mail", type: "text", group: "Winkel" },
  store_instagram: { label: "Instagram URL", type: "text", group: "Social" },
  store_facebook: { label: "Facebook URL", type: "text", group: "Social" },
  store_tiktok: { label: "TikTok URL", type: "text", group: "Social" },
};

