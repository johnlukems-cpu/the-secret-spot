import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getActiveZones } from "@/lib/data/catalog";
import { AddressForm } from "./address-form";
import { deleteAddressAction } from "../actions";

export default async function AddressesPage() {
  const session = await requireUser();
  const supabase = await createClient();
  const { data: c } = await supabase.from("customers").select("id").eq("user_id", session.userId).maybeSingle();
  const { data: addresses } = c ? await supabase.from("customer_addresses").select("id, label, address_line, instructions, is_default, delivery_zones(name)").eq("customer_id", c.id) : { data: [] };
  const zones = await getActiveZones();
  return (
    <div className="grid gap-10 md:grid-cols-2">
      <div>
        <h2 className="eyebrow mb-4">Opgeslagen adressen</h2>
        {(addresses ?? []).length === 0 ? <p className="text-sm text-taupe">Nog geen adressen opgeslagen.</p> : (
          <ul className="space-y-3">
            {(addresses ?? []).map((a) => (
              <li key={a.id} className="rounded-lg border p-4 text-sm">
                <p className="font-medium">{a.label ?? "Adres"} {a.is_default && <span className="text-xs text-taupe">(standaard)</span>}</p>
                <p>{a.address_line}</p>
                <p className="text-taupe">{(a.delivery_zones as unknown as { name: string } | null)?.name}</p>
                <form action={deleteAddressAction} className="mt-2"><input type="hidden" name="id" value={a.id} /><button className="text-xs underline">Verwijderen</button></form>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div>
        <h2 className="eyebrow mb-4">Nieuw adres</h2>
        <AddressForm zones={zones.map((z) => ({ id: z.id, name: z.name }))} />
      </div>
    </div>
  );
}
