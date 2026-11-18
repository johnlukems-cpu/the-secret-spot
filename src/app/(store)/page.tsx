import Image from "next/image";
import Link from "next/link";
import { ArrowRight, Star } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ProductGrid } from "@/components/store/product-card";
import { NewsletterForm } from "@/components/store/newsletter-form";
import { getPublishedReviews, getSiteContent, listProducts, type ProductQuery } from "@/lib/data/catalog";
import { whatsappLink } from "@/lib/whatsapp";
import { getPublicSettings } from "@/lib/data/catalog";

function Section({ eyebrow, title, href, children }: { eyebrow: string; title: string; href: string; children: React.ReactNode }) {
  return (
    <section className="container py-12 md:py-16">
      <div className="mb-8 flex items-end justify-between gap-4">
        <div>
          <p className="eyebrow mb-2">{eyebrow}</p>
          <h2 className="text-3xl md:text-4xl">{title}</h2>
        </div>
        <Link href={href} className="hidden shrink-0 items-center gap-1 text-xs font-medium uppercase tracking-[0.16em] hover:text-taupe sm:flex">
          Bekijk alles <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </div>
      {children}
      <Link href={href} className="mt-8 flex items-center justify-center gap-1 text-xs font-medium uppercase tracking-[0.16em] sm:hidden">
        Bekijk alles <ArrowRight className="h-3.5 w-3.5" />
      </Link>
    </section>
  );
}

const sections: { key: string; eyebrow: string; title: string; href: string; q: ProductQuery }[] = [
  { key: "new", eyebrow: "Net binnen", title: "Nieuwe collectie", href: "/collectie?flag=new", q: { flag: "new" } },
  { key: "dames", eyebrow: "Dames", title: "Women's Collection", href: "/collectie/dames", q: { category: "dames" } },
  { key: "heren", eyebrow: "Heren", title: "Men's Collection", href: "/collectie/heren", q: { category: "heren" } },
  { key: "kids", eyebrow: "Kids", title: "Voor de kleintjes", href: "/collectie/kids", q: { category: "kids" } },
  { key: "schoenen", eyebrow: "Schoenen", title: "Shoes", href: "/collectie/schoenen", q: { category: "schoenen" } },
  { key: "accessoires", eyebrow: "Accessoires", title: "De finishing touch", href: "/collectie/accessoires", q: { category: "accessoires" } },
  { key: "ready", eyebrow: "Direct leverbaar", title: "Ready-to-Order", href: "/collectie?type=in_stock", q: { type: "in_stock" } },
  { key: "preorder", eyebrow: "Op bestelling", title: "Pre-Order Collectie", href: "/collectie?type=preorder", q: { type: "preorder" } },
  { key: "best", eyebrow: "Favorieten", title: "Best Sellers", href: "/collectie?flag=best", q: { flag: "best" } },
];

export default async function HomePage() {
  const [content, reviews, settings, ...lists] = await Promise.all([
    getSiteContent(), getPublishedReviews(6), getPublicSettings(),
    ...sections.map((s) => listProducts({ ...s.q, pageSize: 4 })),
  ]);
  const hero = content.find((b) => b.block_type === "hero");
  const banners = content.filter((b) => b.block_type === "promo_banner");
  const wa = whatsappLink(settings.store_whatsapp as string, "Hallo The Secret Girl!");

  const renderSection = (i: number) => {
    const s = sections[i];
    const items = lists[i]?.items ?? [];
    if (!items.length) return null;
    return <Section key={s.key} eyebrow={s.eyebrow} title={s.title} href={s.href}><ProductGrid products={items} priorityCount={i === 0 ? 2 : 0} /></Section>;
  };

  return (
    <>
      {/* Hero */}
      <section className="relative overflow-hidden bg-charcoal text-cream">
        {hero?.image_url && (
          <Image src={hero.image_url} alt="" fill priority sizes="100vw" className="object-cover opacity-60" />
        )}
        <div className="container relative grid items-center gap-10 py-12 md:min-h-[78vh] md:grid-cols-2 md:py-16 [&>*]:min-w-0">
          <div className="order-2 md:order-1">
            <p className="eyebrow mb-4 !text-gold">THE SECRET GIRL</p>
            <h1 className="max-w-3xl text-5xl leading-[1.05] md:text-6xl lg:text-7xl">{hero?.title ?? "YOUR STYLE. YOUR SECRET."}</h1>
            {hero?.subtitle && <p className="mt-5 max-w-xl text-base text-cream/80 md:text-lg">{hero.subtitle}</p>}
            <div className="mt-8 flex flex-wrap gap-3">
              <Button asChild variant="gold" size="lg"><Link href={hero?.link_url ?? "/collectie"}>{hero?.cta_label ?? "Shop de collectie"}</Link></Button>
              <Button asChild variant="outline" size="lg" className="border-cream/40 text-cream hover:bg-cream/10"><Link href="/collectie?type=preorder">Pre-order</Link></Button>
            </div>
          </div>
          {!hero?.image_url && (
            <div className="order-1 md:order-2">
              <div className="relative mx-auto aspect-[3/2] w-full max-w-xl overflow-hidden rounded-lg bg-[#F8EDE4] shadow-2xl ring-1 ring-gold/30">
                <Image src="/brand/the-secret-girl.webp" alt="The Secret Girl" fill priority sizes="(min-width:768px) 50vw, 100vw" className="object-contain" />
              </div>
            </div>
          )}
        </div>
      </section>

      {/* Category tiles */}
      <section className="container grid grid-cols-2 gap-3 py-10 md:grid-cols-5">
        {[["Dames", "dames"], ["Heren", "heren"], ["Kids", "kids"], ["Schoenen", "schoenen"], ["Accessoires", "accessoires"]].map(([n, s]) => (
          <Link key={s} href={`/collectie/${s}`} className="group flex aspect-[4/3] items-end bg-cream p-4 transition hover:bg-cream-dark md:aspect-square last:col-span-2 last:aspect-[8/3] md:last:col-span-1 md:last:aspect-square">
            <span className="font-display text-2xl">{n}<ArrowRight className="ml-1 inline h-4 w-4 transition group-hover:translate-x-1" /></span>
          </Link>
        ))}
      </section>

      {renderSection(0)}
      {renderSection(1)}

      {banners.length > 0 && (
        <section className="container grid gap-3 py-6 md:grid-cols-2">
          {banners.map((b) => (
            <Link key={b.id} href={b.link_url ?? "/collectie"} className="relative flex min-h-[260px] flex-col justify-end overflow-hidden bg-charcoal p-8 text-cream">
              {b.image_url && <Image src={b.image_url} alt="" fill sizes="50vw" className="object-cover opacity-50" />}
              <div className="relative">
                <h3 className="text-3xl">{b.title}</h3>
                {b.subtitle && <p className="mt-2 max-w-md text-sm text-cream/80">{b.subtitle}</p>}
                {b.cta_label && <span className="mt-4 inline-flex items-center gap-1 text-xs uppercase tracking-[0.16em] text-gold">{b.cta_label} <ArrowRight className="h-3.5 w-3.5" /></span>}
              </div>
            </Link>
          ))}
        </section>
      )}

      {renderSection(2)}
      {renderSection(3)}
      {renderSection(4)}
      {renderSection(5)}
      {renderSection(6)}

      <section className="bg-cream">
        <div className="container grid gap-8 py-14 md:grid-cols-3">
          {[
            ["Ready-to-Order", "Op voorraad in Suriname. Na verificatie van uw aanbetaling leveren we snel bij u thuis."],
            ["Pre-Order", "Wij kopen wekelijks in bij onze leveranciers. U betaalt een aanbetaling, de rest bij levering. Leverdata zijn schattingen."],
            ["Levering in heel Suriname", "Van Paramaribo tot Nickerie. Bezorgkosten ziet u vooraf bij het afrekenen."],
          ].map(([t, d]) => (
            <div key={t}>
              <h3 className="text-2xl">{t}</h3>
              <p className="mt-2 text-sm text-taupe">{d}</p>
            </div>
          ))}
        </div>
      </section>

      {renderSection(7)}
      {renderSection(8)}

      {reviews.length > 0 && (
        <section className="container py-14">
          <p className="eyebrow mb-2">Reviews</p>
          <h2 className="mb-8 text-3xl md:text-4xl">Wat klanten zeggen</h2>
          <div className="grid gap-4 md:grid-cols-3">
            {reviews.map((r) => (
              <figure key={r.id} className="border p-6">
                <div className="flex gap-0.5 text-gold" aria-label={`${r.rating} van 5 sterren`}>
                  {Array.from({ length: 5 }).map((_, i) => <Star key={i} className={`h-4 w-4 ${i < r.rating ? "fill-current" : ""}`} />)}
                </div>
                <blockquote className="mt-3 text-sm">“{r.body}”</blockquote>
                <figcaption className="mt-3 text-xs uppercase tracking-wide text-taupe">{r.author_name}</figcaption>
              </figure>
            ))}
          </div>
        </section>
      )}

      <section className="bg-charcoal text-cream">
        <div className="container grid gap-10 py-14 md:grid-cols-2 [&>*]:min-w-0">
          <div>
            <h2 className="text-3xl">Blijf op de hoogte</h2>
            <p className="mt-2 text-sm text-cream/70">Nieuwe collecties, pre-order rondes en aanbiedingen als eerste in uw inbox.</p>
            <div className="mt-6 max-w-md"><NewsletterForm /></div>
          </div>
          <div className="md:border-l md:border-cream/10 md:pl-10">
            <h2 className="text-3xl">Vragen?</h2>
            <p className="mt-2 text-sm text-cream/70">Ons team helpt u graag met maten, beschikbaarheid en uw bestelling.</p>
            <div className="mt-6 flex flex-wrap gap-3">
              {wa && <Button asChild variant="gold"><a href={wa} target="_blank" rel="noopener noreferrer">Chat via WhatsApp</a></Button>}
              <Button asChild variant="outline" className="border-cream/40 text-cream hover:bg-cream/10"><Link href="/contact">Contactformulier</Link></Button>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
