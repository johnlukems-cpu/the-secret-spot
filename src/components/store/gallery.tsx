"use client";
import Image from "next/image";
import { useState } from "react";
import type { ProductImage } from "@/lib/types";

export function Gallery({ images, title }: { images: ProductImage[]; title: string }) {
  const [active, setActive] = useState(0);
  if (!images.length) return <div className="flex aspect-[3/4] items-center justify-center bg-cream text-sm text-taupe">Geen afbeelding</div>;
  return (
    <div className="space-y-3">
      <div className="relative aspect-[3/4] overflow-hidden bg-cream">
        <Image src={images[active].url} alt={images[active].alt ?? title} fill priority sizes="(min-width:1024px) 50vw, 100vw" className="object-cover" />
      </div>
      {images.length > 1 && (
        <div className="flex gap-2 overflow-x-auto">
          {images.map((img, i) => (
            <button key={img.id} type="button" onClick={() => setActive(i)} aria-label={`Afbeelding ${i + 1}`}
              className={`relative h-20 w-16 shrink-0 overflow-hidden border-2 ${i === active ? "border-charcoal" : "border-transparent"}`}>
              <Image src={img.url} alt="" fill sizes="64px" className="object-cover" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
