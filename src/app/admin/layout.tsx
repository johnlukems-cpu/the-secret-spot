import type { Metadata } from "next";
import { AdminSidebar } from "@/components/admin/sidebar";
import { adminNav } from "@/components/admin/nav";
import { can, requireStaff } from "@/lib/auth";

export const metadata: Metadata = { title: { default: "Admin", template: "%s · Admin" }, robots: { index: false, follow: false } };

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await requireStaff();
  const nav = adminNav
    .map((g) => ({ group: g.group, items: g.items.filter((i) => can(session, i.perm)).map(({ perm: _p, ...rest }) => rest) }))
    .filter((g) => g.items.length);
  return (
    <div className="min-h-screen bg-[#FAF8F4] lg:flex">
      <AdminSidebar nav={nav} user={{ email: session.email, roles: session.roles }} />
      <main className="min-w-0 flex-1 p-4 md:p-8">{children}</main>
    </div>
  );
}
