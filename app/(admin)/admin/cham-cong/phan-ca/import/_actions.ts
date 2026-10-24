"use server";

// app/(admin)/admin/cham-cong/phan-ca/import/_actions.ts — L1: import lịch phân ca từ file
// Sheet (.xlsx). Hai bước: xem trước (parse + gợi ý ánh xạ tên) → áp (khung ca + lưới tháng).
// Auth + quyền ở đây; lõi ở lib/cham-cong/import-core.ts (test tích hợp gọi thẳng).
//
// Quyền: `hr_attendance:assign` theo CƠ SỞ. QLCS CS1 áp được hàng CS1; hàng CS2/HO bị bỏ qua
// và ĐẾM RIÊNG trong kết quả (không im lặng). Nhân sự HO có GLOBAL áp được tất cả.
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { checkPermission } from "@/lib/auth/check-permission";
import { resolveActor } from "@/lib/auth/actor";
import { scopedDb } from "@/lib/db-scope";
import { parseWorkbook } from "@/lib/cham-cong/sheet-parse";
import { applyImport, buildImportPreview, toCandidates, type ApplyResult, type ImportDb, type ImportPreview } from "@/lib/cham-cong/import-core";
import { loadCenterMap } from "@/lib/cham-cong/home-center";
import { markAttendanceDaysDirtyMany } from "@/lib/cham-cong/recompute";
import { writeAudit } from "@/lib/audit/audit-log";

const MAX_BYTES = 2 * 1024 * 1024;

type Res<T> = { ok: true; data: T } | { ok: false; error: string };

async function readFile(formData: FormData): Promise<Res<Buffer>> {
  const file = formData.get("file");
  if (!(file instanceof File)) return { ok: false, error: "Chưa chọn file .xlsx" };
  if (!/\.xlsx$/i.test(file.name)) return { ok: false, error: "Chỉ nhận file .xlsx (tải Google Sheet về dạng Excel)" };
  if (file.size > MAX_BYTES) return { ok: false, error: "File quá 2MB — không phải file lịch phân ca" };
  return { ok: true, data: Buffer.from(await file.arrayBuffer()) };
}

/** Quyền assign theo từng cơ sở (kể cả "hoi-so") — tính một lần cho cả lượt import. */
async function assignableCenters(): Promise<{ map: Awaited<ReturnType<typeof loadCenterMap>>; allowed: Set<string> }> {
  const map = await loadCenterMap();
  const ids = [...Object.values(map.byCode).map((c) => c.centerId), map.hoCenterId];
  const allowed = new Set<string>();
  for (const id of ids) if (await checkPermission("hr_attendance:assign", { centerId: id })) allowed.add(id);
  return { map, allowed };
}

export async function previewImportAction(formData: FormData): Promise<Res<ImportPreview & { centers: string[] }>> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: "Chưa đăng nhập" };
  const { allowed, map } = await assignableCenters();
  if (allowed.size === 0) return { ok: false, error: "Không có quyền phân ca ở cơ sở nào" };

  const f = await readFile(formData);
  if (!f.ok) return f;
  let parsed;
  try {
    parsed = parseWorkbook(f.data);
  } catch (e) {
    return { ok: false, error: `Không đọc được file: ${(e as Error).message}` };
  }
  if (parsed.khungCa.length === 0 && parsed.months.length === 0) {
    return { ok: false, error: "File không có tab KHUNG CA CỐ ĐỊNH hay LỊCH Tmm-yyyy — đúng file lịch phân ca chưa?" };
  }

  const actor = await resolveActor(session.user.id);
  const sdb = scopedDb(actor);
  const employees = await sdb.employee.findMany({
    where: { status: "ACTIVE" },
    select: { id: true, fullName: true, phone: true, center: { select: { code: true } }, userAccount: { select: { id: true, name: true } } },
  });
  // scopedDb là client $extends — cùng API runtime với PrismaClient nhưng kiểu generic khác nên ép kiểu.
  const preview = await buildImportPreview(parsed, { db: sdb as unknown as ImportDb, candidates: toCandidates(employees) });
  const centers = Object.entries(map.byCode)
    .filter(([, c]) => allowed.has(c.centerId))
    .map(([code]) => code)
    .concat(allowed.has(map.hoCenterId) ? ["HO"] : []);
  return { ok: true, data: { ...preview, centers } };
}

const applySchema = z.object({
  mapping: z.record(z.string(), z.string().min(1)),
  periodKeys: z.array(z.string().regex(/^\d{4}-\d{2}$/)).max(12),
  importKhungCa: z.boolean(),
});

export async function applyImportAction(formData: FormData): Promise<Res<ApplyResult>> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: "Chưa đăng nhập" };
  const { allowed, map } = await assignableCenters();
  if (allowed.size === 0) return { ok: false, error: "Không có quyền phân ca ở cơ sở nào" };

  const f = await readFile(formData);
  if (!f.ok) return f;
  let input: z.infer<typeof applySchema>;
  try {
    input = applySchema.parse({
      mapping: JSON.parse(String(formData.get("mapping") ?? "{}")),
      periodKeys: JSON.parse(String(formData.get("periodKeys") ?? "[]")),
      importKhungCa: formData.get("importKhungCa") === "1",
    });
  } catch {
    return { ok: false, error: "Dữ liệu ánh xạ/kỳ không hợp lệ" };
  }
  let parsed;
  try {
    parsed = parseWorkbook(f.data);
  } catch (e) {
    return { ok: false, error: `Không đọc được file: ${(e as Error).message}` };
  }

  // Ánh xạ chỉ được trỏ tới nhân sự trong tầm nhìn (scopedDb lọc Employee theo cơ sở).
  const actor = await resolveActor(session.user.id);
  const sdb = scopedDb(actor);
  const employees = await sdb.employee.findMany({
    where: { status: "ACTIVE", userAccount: { isNot: null } },
    select: { id: true, userAccount: { select: { id: true } } },
  });
  const okUserIds = new Set(employees.map((e) => e.userAccount!.id));
  const employeeByUser = new Map(employees.map((e) => [e.userAccount!.id, e.id]));
  const mapping: Record<string, string> = {};
  for (const [name, userId] of Object.entries(input.mapping)) {
    if (!okUserIds.has(userId)) continue;
    mapping[name] = userId;
    mapping[`employee:${name}`] = employeeByUser.get(userId) ?? "";
  }

  const result = await applyImport(parsed, {
    db: sdb as unknown as ImportDb,
    mapping,
    periodKeys: input.periodKeys,
    centerMap: map,
    canWriteCenter: (centerId) => allowed.has(centerId),
    actorUserId: session.user.id,
    importKhungCa: input.importKhungCa,
  });

  // L2: ngày có ca đổi → xếp hàng tính lại bảng công (DomainEvent, không chờ ở đây).
  await markAttendanceDaysDirtyMany(result.changedDays, { reason: "import" });

  await writeAudit({
    actor: { id: session.user.id, name: session.user.name ?? session.user.email ?? "" },
    module: "hr_attendance",
    entityType: "ShiftAssignment",
    entityId: input.periodKeys.join(",") || "khung-ca",
    action: "IMPORT",
    newValues: {
      periodKeys: input.periodKeys,
      importKhungCa: input.importKhungCa,
      patterns: result.patterns,
      assignments: result.assignments,
      counts: result.counts,
      warnings: result.warnings.slice(0, 20),
    },
  });
  revalidatePath("/cham-cong");
  revalidatePath("/cham-cong/phan-ca");
  return { ok: true, data: result };
}
