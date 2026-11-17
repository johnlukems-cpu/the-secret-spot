import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { ProfileForm } from "./profile-form";

export default async function ProfilePage() {
  const session = await requireUser();
  const supabase = await createClient();
  const { data: c } = await supabase.from("customers").select("full_name, whatsapp").eq("user_id", session.userId).maybeSingle();
  const { data: p } = await supabase.from("profiles").select("full_name, phone").eq("id", session.userId).maybeSingle();
  return <ProfileForm fullName={c?.full_name ?? p?.full_name ?? ""} whatsapp={c?.whatsapp ?? p?.phone ?? ""} />;
}
