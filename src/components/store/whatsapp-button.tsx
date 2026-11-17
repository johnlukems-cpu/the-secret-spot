import { MessageCircle } from "lucide-react";
import { whatsappLink } from "@/lib/whatsapp";

export function WhatsAppButton({ number }: { number?: string | null }) {
  const href = whatsappLink(number, "Hallo The Secret Spot, ik heb een vraag.");
  if (!href) return null;
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" aria-label="Chat via WhatsApp"
       className="fixed bottom-5 right-5 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-[#25D366] text-white shadow-lg transition hover:scale-105">
      <MessageCircle className="h-6 w-6" />
    </a>
  );
}
