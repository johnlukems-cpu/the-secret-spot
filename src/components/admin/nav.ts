import type { Permission } from "@/lib/auth";

export const adminNav: { group: string; items: { href: string; label: string; perm: Permission; icon: string }[] }[] = [
  { group: "Overzicht", items: [{ href: "/admin", label: "Dashboard", perm: "dashboard.view", icon: "LayoutDashboard" }] },
  {
    group: "Verkoop",
    items: [
      { href: "/admin/orders", label: "Bestellingen", perm: "orders.view", icon: "ShoppingBag" },
      { href: "/admin/payments", label: "Betalingen", perm: "payments.view", icon: "Landmark" },
      { href: "/admin/quotations", label: "Offertes", perm: "orders.view", icon: "FileText" },
      { href: "/admin/preorders", label: "Pre-orders", perm: "preorders.manage", icon: "Clock" },
      { href: "/admin/customers", label: "Klanten", perm: "customers.view", icon: "Users" },
      { href: "/admin/deliveries", label: "Leveringen", perm: "deliveries.view", icon: "Truck" },
    ],
  },
  {
    group: "Catalogus",
    items: [
      { href: "/admin/products", label: "Producten", perm: "products.manage", icon: "Shirt" },
      { href: "/admin/categories", label: "Categorieën", perm: "categories.manage", icon: "FolderTree" },
      { href: "/admin/inventory", label: "Voorraad", perm: "inventory.manage", icon: "Boxes" },
      { href: "/admin/promotions", label: "Promoties", perm: "promotions.manage", icon: "BadgePercent" },
    ],
  },
  {
    group: "Import & inkoop",
    items: [
      { href: "/admin/suppliers", label: "Leveranciers", perm: "suppliers.manage", icon: "Factory" },
      { href: "/admin/purchasing", label: "Inkooprapport", perm: "purchasing.manage", icon: "ClipboardList" },
      { href: "/admin/batches", label: "Inkoopbatches & PO's", perm: "purchasing.manage", icon: "Package" },
      { href: "/admin/shipments", label: "Zendingen", perm: "shipments.manage", icon: "Ship" },
      { href: "/admin/pricing", label: "Prijscalculator", perm: "pricing.manage", icon: "Calculator" },
    ],
  },
  {
    group: "Financiën",
    items: [
      { href: "/admin/finance", label: "Financieel overzicht", perm: "finance.view", icon: "Wallet" },
      { href: "/admin/expenses", label: "Uitgaven", perm: "expenses.manage", icon: "Receipt" },
      { href: "/admin/reports", label: "Rapportages", perm: "reports.view", icon: "BarChart3" },
    ],
  },
  {
    group: "Beheer",
    items: [
      { href: "/admin/content", label: "Website content", perm: "content.manage", icon: "Image" },
      { href: "/admin/notifications", label: "Notificaties", perm: "notifications.manage", icon: "Bell" },
      { href: "/admin/users", label: "Gebruikers & rechten", perm: "users.manage", icon: "ShieldCheck" },
      { href: "/admin/settings", label: "Bedrijfsinstellingen", perm: "settings.manage", icon: "Settings" },
      { href: "/admin/bank", label: "Bankgegevens", perm: "settings.bank", icon: "Banknote" },
      { href: "/admin/audit", label: "Audit log", perm: "audit.view", icon: "History" },
    ],
  },
];
