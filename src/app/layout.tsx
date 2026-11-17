import type { Metadata, Viewport } from "next";
import { Cormorant_Garamond, Inter } from "next/font/google";
import { Toaster } from "sonner";
import { publicEnv } from "@/lib/env";
import "./globals.css";

const display = Cormorant_Garamond({ subsets: ["latin"], weight: ["500", "600"], variable: "--font-display", display: "swap" });
const sans = Inter({ subsets: ["latin"], variable: "--font-sans", display: "swap" });

export const metadata: Metadata = {
  metadataBase: new URL(publicEnv.siteUrl),
  title: { default: "THE SECRET SPOT – Mode voor het hele gezin in Suriname", template: "%s | THE SECRET SPOT" },
  description: "YOUR STYLE. YOUR SECRET. Online mode voor dames, heren en kids in Suriname – direct leverbaar of als pre-order. Levering in heel Suriname.",
  openGraph: { type: "website", locale: "nl_SR", siteName: "THE SECRET SPOT", images: ["/brand/logo.svg"] },
  alternates: { canonical: "/" },
};

export const viewport: Viewport = { themeColor: "#171A18", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="nl" className={`${display.variable} ${sans.variable}`}>
      <body>
        {children}
        <Toaster position="top-center" richColors />
      </body>
    </html>
  );
}
