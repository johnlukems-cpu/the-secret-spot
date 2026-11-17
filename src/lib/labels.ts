export const orderStatusLabel: Record<string, string> = {
  awaiting_deposit: "Wacht op aanbetaling",
  payment_review: "Betaling wordt gecontroleerd",
  confirmed: "Bevestigd",
  purchasing: "Wordt ingekocht",
  in_transit: "Onderweg naar Suriname",
  ready_for_delivery: "Klaar voor levering",
  out_for_delivery: "Onderweg naar u",
  delivered: "Geleverd",
  completed: "Afgerond",
  cancelled: "Geannuleerd",
  expired: "Verlopen",
};

export const paymentStatusLabel: Record<string, string> = {
  awaiting_deposit: "Wacht op aanbetaling",
  proof_submitted: "Bewijs ingediend",
  under_verification: "In verificatie",
  deposit_verified: "Aanbetaling geverifieerd",
  partially_paid: "Gedeeltelijk betaald",
  fully_paid: "Volledig betaald",
  rejected: "Afgewezen",
  refunded: "Terugbetaald",
};

export const paymentRecordLabel: Record<string, string> = {
  submitted: "Ingediend",
  under_verification: "In verificatie",
  verified: "Geverifieerd",
  rejected: "Afgewezen",
  refunded: "Terugbetaald",
};

export const fulfilmentLabel: Record<string, string> = {
  pending: "Wacht op aanbetaling",
  reserved: "Gereserveerd",
  awaiting_purchase: "Wacht op inkoop",
  purchased: "Ingekocht",
  in_transit: "Onderweg",
  received: "Deels ontvangen",
  allocated: "Klaar",
  delivered: "Geleverd",
  cancelled: "Geannuleerd",
};

export const deliveryStatusLabel: Record<string, string> = {
  awaiting_preparation: "Wacht op voorbereiding",
  ready_for_delivery: "Klaar voor levering",
  assigned: "Toegewezen",
  out_for_delivery: "Onderweg",
  delivered: "Geleverd",
  failed: "Mislukt",
  rescheduled: "Opnieuw ingepland",
};

export const shipmentStatusLabel: Record<string, string> = {
  preparing: "Voorbereiding",
  purchased: "Ingekocht",
  supplier_processing: "Bij leverancier",
  ready_for_shipment: "Klaar voor verzending",
  shipped: "Verzonden",
  in_transit: "Onderweg",
  customs_clearance: "Douane-inklaring",
  arrived: "Aangekomen in Suriname",
  received: "Ontvangen",
  closed: "Afgesloten",
};

export const purchaseStatusLabel: Record<string, string> = {
  draft: "Concept", ordered: "Besteld", supplier_confirmed: "Bevestigd door leverancier",
  partially_received: "Deels ontvangen", received: "Ontvangen", cancelled: "Geannuleerd",
};

export const roleLabel: Record<string, string> = {
  super_admin: "Super Administrator", admin: "Administrator", finance_manager: "Finance Manager",
  inventory_manager: "Inventory Manager", order_manager: "Order Manager", purchasing_manager: "Purchasing Manager",
  delivery_manager: "Delivery Manager", customer: "Klant",
};

export function statusVariant(status: string): "success" | "warning" | "danger" | "info" | "outline" | "gold" {
  if (["completed", "fully_paid", "verified", "delivered", "received", "deposit_verified", "closed"].includes(status)) return "success";
  if (["cancelled", "expired", "rejected", "failed", "refunded"].includes(status)) return "danger";
  if (["awaiting_deposit", "proof_submitted", "under_verification", "payment_review", "submitted", "partially_paid"].includes(status)) return "warning";
  if (["ready_for_delivery", "out_for_delivery", "in_transit", "shipped", "arrived"].includes(status)) return "info";
  return "outline";
}
