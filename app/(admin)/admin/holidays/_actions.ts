"use server";

import { auth } from "@/lib/auth";
import { checkPermission } from "@/lib/auth/check-permission";
import { HO_CENTER_ID, loadCenterMap } from "@/lib/cham-cong/home-center";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { applyHolidayShift, type KetQuaDoiNgayNghi } from "@/lib/holidays/apply";
import { centerIdForOrgUnit } from "@/lib/org/org-service";
import { resolveActor, type Actor } from "@/lib/auth/actor";
import { passesScope, scopedDb } from "@/lib/db-scope";

type ActionResult = {
  error?: string;
  /** 27/09/2026 — số buổi/lớp đã dời lùi một nhịp, để màn hình NÓI RA việc hệ thống vừa làm. */
  daDoi?: KetQuaDoiNgayNghi;
};

// Cách ly cơ sở: Holiday ∈ SCOPED_MODELS. centerId=null = ngày nghỉ TOÀN HỆ THỐNG
// → chỉ SUPER_ADMIN/HO được tạo/sửa/xoá. CENTER_MANAGER chỉ thao tác ngày nghỉ
// thuộc cơ sở mình (chống IDOR ghi liên cơ sở).
// GHI đối xứng với ĐỌC (vá 24/07): scope per-model qua passesScope — ngày nghỉ TOÀN HỆ
// THỐNG (centerId null) đòi scope ALL (role HO có quyền holidays:/centers:), không còn
// mở cho mọi role @HO; center-level chỉ nhắm cơ sở trong scope.
/**
 * CÓ ĐƯỢC TẠO/SỬA/XOÁ ngày nghỉ ở phạm vi này không — luật GHI, chặt hơn luật ĐỌC.
 *
 * ⚠️ 04/09/2026 — KHÔNG dùng thẳng `passesScope` nữa. `Holiday` nay nằm trong
 * `NULL_IS_GLOBAL_MODELS` để người cấp cơ sở ĐỌC được ngày nghỉ toàn hệ thống
 * (Tết, lễ — 4/6 ngày nghỉ thật, và là những ngày sinh ra lịch buổi học). Nhưng
 * `passesScope` là luật ĐỌC: sau thay đổi đó nó trả `true` cho `centerId = null`,
 * và hàm này vốn gọi thẳng nó ⇒ quản lý một cơ sở sẽ TẠO/XOÁ được ngày nghỉ áp
 * cho MỌI cơ sở. Đó là nới quyền, không phải sửa lỗi.
 *
 * Luật ghi cho phạm vi "toàn hệ thống": CHỈ quản trị hệ thống.
 *
 * Khớp đúng seed — `holidays:edit` chỉ cấp cho `SUPER_ADMIN`
 * (`prisma/seed-roles.ts`, ghi chú tại khối CENTER_MANAGER). Và giữ nguyên hành vi
 * đang chạy: cổng vào màn này (`requireAdmin`) chỉ cho SUPER_ADMIN + CENTER_MANAGER,
 * mà CENTER_MANAGER chỉ có `holidays:view` phạm vi CENTER ⇒ trước nay cũng chỉ
 * SUPER_ADMIN tạo được ngày nghỉ toàn hệ thống.
 *
 * ⚠️ Vì sao KHÔNG viết `getModelVisibleCenterIds("Holiday", actor) === "ALL"`
 * (bản đầu của tôi): hàm đó gộp mọi quyền cùng tiền tố `holidays:`/`centers:`, nên
 * một vai chỉ có `holidays:VIEW` phạm vi GLOBAL cũng ra "ALL" — tức quyền ĐỌC được
 * đọc thành quyền GHI. Tệ hơn, khi vai KHÔNG có quyền `holidays:` nào thì hàm rơi
 * về nhánh dự phòng `isHoLevel ? "ALL" : …`, biến "có một vai neo tại Hội sở"
 * thành quyền sửa lịch nghỉ toàn hệ thống. Hôm nay hai ca đó chưa với tới được
 * action vì `requireAdmin` chặn, nhưng đó là hàng rào ở NƠI KHÁC — chỉ cần seed đổi
 * một dòng là thủng, và thủng im lặng.
 *
 * ⚠️ Cũng KHÔNG dùng `actor.isHoLevel`: cờ đó chỉ nói "có một vai nào đó neo tại
 * Hội sở", không nói người này được làm gì — đúng lỗi mà
 * `lib/db-scope-function.test.ts` sinh ra để chặn.
 */
function actorCanUseCenterTarget(actor: Actor, centerId: string | null): boolean {
  if (centerId === null) return actor.isSuperAdmin;
  return passesScope("Holiday", { centerId }, actor);
}

const HOLIDAY_TYPES = ["HOLIDAY", "MAINTENANCE", "EVENT", "OTHER"] as const;

const dateOnly = z
  .string()
  .trim()
  .min(1)
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Ngày phải dạng YYYY-MM-DD")
  .transform((s) => {
    const [y, m, d] = s.split("-").map((x) => parseInt(x, 10));
    return new Date(Date.UTC(y, m - 1, d));
  });

const holidaySchema = z
  .object({
    name: z.string().trim().min(1, "Tên ngày nghỉ bắt buộc"),
    date: dateOnly,
    endDate: z
      .string()
      .trim()
      .optional()
      .transform((s) => (s && s.length > 0 ? s : null))
      .pipe(
        z.union([
          z.null(),
          z
            .string()
            .regex(/^\d{4}-\d{2}-\d{2}$/, "Ngày kết thúc phải dạng YYYY-MM-DD")
            .transform((s) => {
              const [y, m, d] = s.split("-").map((x) => parseInt(x, 10));
              return new Date(Date.UTC(y, m - 1, d));
            }),
        ]),
      ),
    // PR-C: đơn vị (OrgUnit) là nguồn chính; "ALL"/"" = toàn hệ thống (null).
    orgUnitId: z
      .string()
      .optional()
      .transform((s) => {
        if (!s || s === "" || s === "ALL") return null;
        return s;
      }),
    type: z.enum(HOLIDAY_TYPES).default("HOLIDAY"),
    note: z
      .string()
      .optional()
      .transform((s) => {
        if (!s) return null;
        const t = s.trim();
        return t.length > 0 ? t : null;
      }),
    // ── Module chấm công v3 (L3, T-04) ─────────────────────────────────────
    attendanceEffect: z.enum(["PAID_LEAVE", "UNPAID_OFF", "INFO_ONLY"]).nullable().default(null),
    coefficient: z.coerce.number().min(0, "Hệ số ≥ 0").max(5, "Hệ số ≤ 5").default(1),
    briefMode: z.enum(["APPEND", "SUPPRESS", "REPLACE"]).nullable().default(null),
    briefText: z
      .string()
      .optional()
      .transform((s) => {
        if (!s) return null;
        const t = s.trim();
        return t.length > 0 ? t : null;
      }),
  })
  .refine(
    (d) => d.endDate === null || d.endDate.getTime() >= d.date.getTime(),
    { message: "Ngày kết thúc phải >= ngày bắt đầu", path: ["endDate"] },
  );

function emptyToUndefined(value: FormDataEntryValue | null): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

// L3 chấm công v3 (T-04): lễ + HỆ SỐ CÔNG do Kế toán tự set ⇒ cổng = `holidays:edit` HOẶC
// `hr_attendance:config`, xét theo TỪNG cơ sở (kể cả "hoi-so"): có quyền ở ít nhất một nơi
// thì vào được; phạm vi từng dòng vẫn do passesScope ở create/update quyết.
// Trước đây gác cứng hasAnyRole(SUPER_ADMIN, CENTER_MANAGER) ⇒ Kế toán bị đá trước validator.
async function requireAdmin() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const map = await loadCenterMap();
  const ids = [...Object.values(map.byCode).map((c) => c.centerId), HO_CENTER_ID];
  let ok = false;
  for (const centerId of ids) {
    if ((await checkPermission("holidays:edit", { centerId })) || (await checkPermission("hr_attendance:config", { centerId }))) {
      ok = true;
      break;
    }
  }
  if (!ok) redirect("/dashboard?error=unauthorized");
  return session.user;
}

function readForm(formData: FormData) {
  return {
    name: emptyToUndefined(formData.get("name")) ?? "",
    date: emptyToUndefined(formData.get("date")) ?? "",
    endDate: emptyToUndefined(formData.get("endDate")),
    orgUnitId: emptyToUndefined(formData.get("orgUnitId")),
    type: (emptyToUndefined(formData.get("type")) ?? "HOLIDAY") as
      | "HOLIDAY"
      | "MAINTENANCE"
      | "EVENT"
      | "OTHER",
    note: emptyToUndefined(formData.get("note")),
    attendanceEffect: (emptyToUndefined(formData.get("attendanceEffect")) ?? null) as "PAID_LEAVE" | "UNPAID_OFF" | "INFO_ONLY" | null,
    coefficient: emptyToUndefined(formData.get("coefficient")) ?? "1",
    briefMode: (emptyToUndefined(formData.get("briefMode")) ?? null) as "APPEND" | "SUPPRESS" | "REPLACE" | null,
    briefText: emptyToUndefined(formData.get("briefText")),
  };
}

// PR-C dual-write: ghi orgUnitId (nguồn chính) + centerId (suy ra, scopedDb cũ).
// HO → orgUnitId set nhưng centerId null; "ALL" → cả 2 null (toàn hệ thống).
function toCreate(
  c: z.infer<typeof holidaySchema>,
  centerId: string | null,
): Prisma.HolidayCreateInput {
  return {
    name: c.name,
    date: c.date,
    endDate: c.endDate,
    type: c.type,
    note: c.note,
    attendanceEffect: c.attendanceEffect,
    coefficient: c.coefficient,
    briefMode: c.briefMode,
    briefText: c.briefText,
    orgUnitId: c.orgUnitId,
    center: centerId ? { connect: { id: centerId } } : undefined,
  };
}

function toUpdate(
  c: z.infer<typeof holidaySchema>,
  centerId: string | null,
): Prisma.HolidayUpdateInput {
  return {
    name: c.name,
    date: c.date,
    endDate: c.endDate,
    type: c.type,
    note: c.note,
    attendanceEffect: c.attendanceEffect,
    coefficient: c.coefficient,
    briefMode: c.briefMode,
    briefText: c.briefText,
    orgUnitId: c.orgUnitId,
    center: centerId ? { connect: { id: centerId } } : { disconnect: true },
  };
}

export async function createHoliday(formData: FormData): Promise<ActionResult> {
  const user = await requireAdmin();

  const parsed = holidaySchema.safeParse(readForm(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" };
  }

  // PR-C: suy centerId từ orgUnitId (HO → null; "ALL" → null).
  const centerId = await centerIdForOrgUnit(parsed.data.orgUnitId);

  // Cách ly cơ sở: center-level không được tạo ngày nghỉ toàn hệ thống / cơ sở khác.
  const actor = await resolveActor(user.id);
  if (!actorCanUseCenterTarget(actor, centerId)) {
    return { error: "Không có quyền tạo ngày nghỉ cho phạm vi cơ sở này" };
  }
  const sdb = scopedDb(actor);

  let created: { date: Date; endDate: Date | null; centerId: string | null };
  try {
    created = await sdb.holiday.create({
      data: toCreate(parsed.data, centerId),
      select: { date: true, endDate: true, centerId: true },
    });
  } catch {
    return { error: "Lỗi cơ sở dữ liệu — không tạo được ngày nghỉ" };
  }

  // P1-f — dời các buổi tương lai trùng ngày nghỉ + báo GV (best-effort).
  let daDoi: ActionResult["daDoi"];
  try {
    daDoi = await applyHolidayShift(created, { id: user.id, name: user.name ?? user.email ?? "Quản trị" });
  } catch (err) {
    console.error("[createHoliday] shift error:", err);
  }

  revalidatePath("/holidays");
  revalidatePath("/sessions");
  // Thành công → client toast + điều hướng (QA 20/07 — không redirect âm thầm).
  return { daDoi };
}

export async function updateHoliday(
  id: string,
  formData: FormData,
): Promise<ActionResult> {
  const user = await requireAdmin();

  const parsed = holidaySchema.safeParse(readForm(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" };
  }

  // PR-C: suy centerId từ orgUnitId (HO → null; "ALL" → null).
  const centerId = await centerIdForOrgUnit(parsed.data.orgUnitId);

  // Cách ly cơ sở (chống IDOR ghi): ngày nghỉ HIỆN TẠI + phạm vi ĐÍCH đều phải
  // thuộc tầm nhìn actor. sdb.findUnique tự null-filter record ngoài scope.
  const actor = await resolveActor(user.id);
  const sdb = scopedDb(actor);
  const existing = await sdb.holiday.findUnique({ where: { id }, select: { centerId: true } });
  if (!existing || !actorCanUseCenterTarget(actor, existing.centerId)) {
    return { error: "Ngày nghỉ không tồn tại" };
  }
  if (!actorCanUseCenterTarget(actor, centerId)) {
    return { error: "Không có quyền chuyển ngày nghỉ sang phạm vi cơ sở này" };
  }

  let updated: { date: Date; endDate: Date | null; centerId: string | null };
  try {
    updated = await sdb.holiday.update({
      where: { id },
      data: toUpdate(parsed.data, centerId),
      select: { date: true, endDate: true, centerId: true },
    });
  } catch {
    return { error: "Ngày nghỉ không tồn tại hoặc lỗi cơ sở dữ liệu" };
  }

  // P1-f — dời buổi trùng ngày nghỉ + báo GV (best-effort).
  let daDoi: ActionResult["daDoi"];
  try {
    daDoi = await applyHolidayShift(updated, { id: user.id, name: user.name ?? user.email ?? "Quản trị" });
  } catch (err) {
    console.error("[updateHoliday] shift error:", err);
  }

  revalidatePath("/holidays");
  revalidatePath(`/holidays/${id}/edit`);
  revalidatePath("/sessions");
  return { daDoi };
}

export async function deleteHoliday(id: string): Promise<ActionResult> {
  const user = await requireAdmin();
  // Cách ly cơ sở: chỉ xoá ngày nghỉ trong tầm nhìn cơ sở của actor (chống IDOR).
  const actor = await resolveActor(user.id);
  const sdb = scopedDb(actor);
  const existing = await sdb.holiday.findUnique({ where: { id }, select: { centerId: true } });
  if (!existing || !actorCanUseCenterTarget(actor, existing.centerId)) {
    return { error: "Ngày nghỉ không tồn tại" };
  }
  try {
    await sdb.holiday.delete({ where: { id } });
  } catch {
    return { error: "Không thể xoá ngày nghỉ này" };
  }
  revalidatePath("/holidays");
  return {};
}
