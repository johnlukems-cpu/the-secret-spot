"use server";
import { redirect } from "next/navigation";
import { adminAction, check } from "../_lib";
import type { ActionResult } from "../action-types";

export async function createBatchAction(_p: unknown, fd: FormData): Promise<ActionResult<unknown>> {
  const supplierId = String(fd.get("supplierId"));
  let id: string | null = null;
  const res = await adminAction("purchasing.manage", async ({ supabase }) => {
    const { data } = check(await supabase.rpc("create_purchase_batch", { _supplier_id: supplierId, _notes: String(fd.get("notes") ?? "") || null }));
    id = data as string;
  }, ["/admin/purchasing", "/admin/batches"]);
  if (res.ok && id) redirect(`/admin/batches/${id}`);
  return res;
}
