"use client";
import Script from "next/script";
import { useEffect, useState } from "react";
import { publicEnv } from "@/lib/env";
import { Button } from "@/components/ui/button";

const KEY = "tss_consent_v1";

/** Tracking (Google Analytics / Meta Pixel) loads only after explicit consent AND configuration. */
export function ConsentBanner() {
  const [consent, setConsent] = useState<"granted" | "denied" | null>(null);
  const [loaded, setLoaded] = useState(false);
  const trackingConfigured = Boolean(publicEnv.gaId || publicEnv.metaPixelId);

  useEffect(() => {
    try { setConsent((localStorage.getItem(KEY) as "granted" | "denied" | null) ?? null); } catch { /* ignore */ }
    setLoaded(true);
  }, []);

  const decide = (v: "granted" | "denied") => {
    setConsent(v);
    try { localStorage.setItem(KEY, v); } catch { /* ignore */ }
  };

  return (
    <>
      {consent === "granted" && publicEnv.gaId && (
        <>
          <Script src={`https://www.googletagmanager.com/gtag/js?id=${publicEnv.gaId}`} strategy="afterInteractive" />
          <Script id="ga" strategy="afterInteractive">{`window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','${publicEnv.gaId}',{anonymize_ip:true});`}</Script>
        </>
      )}
      {consent === "granted" && publicEnv.metaPixelId && (
        <Script id="meta-pixel" strategy="afterInteractive">{`!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');fbq('init','${publicEnv.metaPixelId}');fbq('track','PageView');`}</Script>
      )}
      {loaded && trackingConfigured && consent === null && (
        <div className="fixed inset-x-3 bottom-3 z-50 mx-auto max-w-xl rounded-lg border bg-white p-4 shadow-lg sm:inset-x-auto sm:left-1/2 sm:-translate-x-1/2">
          <p className="text-sm">We gebruiken analytische cookies om onze winkel te verbeteren, alleen met uw toestemming.</p>
          <div className="mt-3 flex gap-2">
            <Button size="sm" onClick={() => decide("granted")}>Accepteren</Button>
            <Button size="sm" variant="outline" onClick={() => decide("denied")}>Weigeren</Button>
          </div>
        </div>
      )}
    </>
  );
}
