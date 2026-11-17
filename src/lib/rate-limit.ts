import "server-only";
import { createHash } from "node:crypto";
import { headers } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";
import { serverEnv } from "@/lib/server-env";

export async function clientKey(): Promise<string> {
  const h = await headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || "unknown";
  return createHash("sha256").update(serverEnv.ipHashSalt + ip).digest("hex").slice(0, 32);
}

/** Fixed-window rate limit stored in Postgres (works across serverless instances). */
export async function rateLimit(action: string, max: number, windowSeconds: number): Promise<boolean> {
  const key = await clientKey();
  const { data, error } = await createAdminClient().rpc("check_rate_limit", {
    _bucket: `${action}:${key}`, _max: max, _window_seconds: windowSeconds,
  });
  if (error) {
    console.error("rate limit check failed", error.message);
    return true; // fail open on infrastructure errors; DB functions still validate everything
  }
  return Boolean(data);
}
