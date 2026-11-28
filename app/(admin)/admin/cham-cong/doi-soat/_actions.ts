"use server";

// app/(admin)/admin/cham-cong/doi-soat/_actions.ts — L6: đối soát Sheet ↔ hệ thống. Chỉ ĐỌC (không
// ghi gì): tải file Sheet lên, so từng ô/ngày/người với lưới + công máy. Quyền `hr_attendance:view`
// tại ít nhất một cơ sở; scopedDb tự cắt theo cơ sở nhìn thấy.
import { auth } from "@/lib/auth";
import { checkPermission } from "@/lib/auth/check-permission";
import { resolveActor } from "@/lib/auth/actor";
import { scopedDb } from "@/lib/db-scope";
import { HO_CENTER_ID, loadCenterMap } from "@/lib/cham-cong/home-center";
import { parseWorkbook } from "@/lib/cham-cong/sheet-parse";
import { reconcileGridWithDb, type ReconcileDb } from "@/lib/cham-cong/reconcile-db";
import type { ReconcileReport } from "@/lib/cham-cong/reconcile";

type Res<T> = { ok: true; data: T } | { ok: false; error: string };
const MAX_BYTES = 2 * 1024 * 1024;

export async function reconcileAction(formData: FormData): Promise<Res<{ reports: ReconcileReport[]; periods: string[] }>> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: "Chưa đăng nhập" };
  const map = await loadCenterMap();
  let allowed = false;
  for (const id of [...Object.values(map.byCode).map((c) => c.centerId), HO_CENTER_ID]) {
    if (await checkPermission("hr_attendance:view", { centerId: id })) { allowed = true; break; }
  }
  if (!allowed) return { ok: false, error: "Không có quyền xem chấm công" };

  const file = formData.get("file");
  if (!(file instanceof File)) return { ok: false, error: "Chưa chọn file .xlsx" };
  if (!/\.xlsx$/i.test(file.name)) return { ok: false, error: "Chỉ nhận file .xlsx (tải Google Sheet về dạng Excel)" };
  if (file.size > MAX_BYTES) return { ok: false, error: "File quá 2MB — không phải file lịch phân ca" };
  let parsed;
  try {
    parsed = parseWorkbook(Buffer.from(await file.arrayBuffer()));
  } catch (e) {
    return { ok: false, error: `Không đọc được file: ${(e as Error).message}` };
  }
  if (parsed.months.length === 0) return { ok: false, error: "File không có tab LỊCH Tmm-yyyy nào" };
  const wanted = String(formData.get("periodKey") ?? "");
  const grids = wanted ? parsed.months.filter((m) => m.periodKey === wanted) : parsed.months;
  if (grids.length === 0) return { ok: false, error: `File không có tab cho kỳ ${wanted}` };

  const sdb = scopedDb(await resolveActor(session.user.id));
  const reports: ReconcileReport[] = [];
  for (const grid of grids) reports.push(await reconcileGridWithDb({ db: sdb as unknown as ReconcileDb, grid }));
  return { ok: true, data: { reports, periods: parsed.months.map((m) => m.periodKey) } };
}
