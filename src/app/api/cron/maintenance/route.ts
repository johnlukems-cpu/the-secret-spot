import { NextResponse, type NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { dispatchPendingNotifications } from "@/lib/notifications";
import { serverEnv } from "@/lib/server-env";

export const dynamic = "force-dynamic";

function authorized(req: NextRequest) {
  const secret = serverEnv.cronSecret;
  if (!secret) return false;
  const header = req.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret}`;
  return header.length === expected.length && timingSafeEqual(Buffer.from(header), Buffer.from(expected));
}

/** Expires unpaid orders/quotations, releases reservations and sends queued notifications. */
export async function GET(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("run_expiry_jobs");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const notifications = await dispatchPendingNotifications(100);
  return NextResponse.json({ ok: true, expiry: data, notifications });
}
