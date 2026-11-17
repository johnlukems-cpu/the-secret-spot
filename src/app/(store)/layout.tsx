import { Header } from "@/components/store/header";
import { Footer } from "@/components/store/footer";
import { CartProvider } from "@/components/store/cart-provider";
import { WhatsAppButton } from "@/components/store/whatsapp-button";
import { ConsentBanner } from "@/components/store/consent";
import { getCategoryTree, getPublicSettings, getSiteContent } from "@/lib/data/catalog";
import { getSession } from "@/lib/auth";
import { isSupabaseConfigured } from "@/lib/env";

export const dynamic = "force-dynamic";

export default async function StoreLayout({ children }: { children: React.ReactNode }) {
  const [categories, settings, content, session] = await Promise.all([getCategoryTree(), getPublicSettings(), getSiteContent(), getSession()]);
  const a = content.find((b) => b.block_type === "announcement");
  return (
    <CartProvider>
      {!isSupabaseConfigured() && (
        <div className="bg-amber-100 px-4 py-2 text-center text-xs text-amber-900">
          Supabase is nog niet geconfigureerd. Zie ENVIRONMENT_VARIABLES.md.
        </div>
      )}
      <Header categories={categories} announcement={a?.title ? { title: a.title, link: a.link_url } : null} isLoggedIn={Boolean(session)} />
      <main id="main" className="min-h-[60vh]">{children}</main>
      <Footer settings={settings} />
      <WhatsAppButton number={settings.store_whatsapp as string} />
      <ConsentBanner />
    </CartProvider>
  );
}
