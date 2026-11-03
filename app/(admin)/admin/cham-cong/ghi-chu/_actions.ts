"use server";

// app/(admin)/admin/cham-cong/ghi-chu/_actions.ts — L3: VIỆC CỐ ĐỊNH (theo thứ) + GHI CHÚ & GHI ĐÈ
// (theo ngày) cho tin nhắc 19:00 (ShiftBriefNote). Không tham gia tính công. Quyền `assign` theo khối.
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { checkPermission } from "@/lib/auth/check-permission";
import { resolveActor } from "@/lib/auth/actor";
import { scopedDb } from "@/lib/db-scope";
import { writeAudit } from "@/lib/audit/audit-log";
import { HO_CENTER_ID, loadCenterMap } from "@/lib/cham-cong/home-center";

type Res = { ok: true } | { ok: false; error: string };

const schema = z
  .object({
    id: z.string().optional(),
    centerId: z.string().min(1),
    weekday: z.coerce.number().int().min(0).max(6).nullable().default(null),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().default(null),
    audience: z.enum(["ALL", "KINH_DOANH", "GIAO_VIEN"]).default("ALL"),
    mode: z.enum(["APPEND", "SUPPRESS", "REPLACE"]).default("APPEND"),
    text: z.string().trim().max(500).default(""),
    isActive: z.coerce.boolean().default(true),
  })
  .refine((v) => (v.weekday === null) !== (v.date === null), { message: "Chọn ĐÚNG MỘT: theo thứ hoặc theo ngày" })
  .refine((v) => v.mode === "SUPPRESS" || v.text.length > 0, { message: "Thiếu nội dung" });

export async function saveBriefNoteAction(input: unknown): Promise<Res> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: "Chưa đăng nhập" };
  const p = schema.safeParse(input);
  if (!p.success) return { ok: false, error: p.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" };
  if (!(await checkPermission("hr_attendance:assign", { centerId: p.data.centerId }))) return { ok: false, error: "Không có quyền ở khối này" };
  const actor = await resolveActor(session.user.id);
  const sdb = scopedDb(actor);
  const map = await loadCenterMap();
  const orgUnitId = p.data.centerId === HO_CENTER_ID ? null : (Object.values(map.byCode).find((c) => c.centerId === p.data.centerId)?.orgUnitId ?? null); // eslint-disable-line no-restricted-syntax -- tra bảng đơn vị, không phải kiểm quyền
  const date = p.data.date ? new Date(`${p.data.date}T00:00:00Z`) : null;
  const data = { centerId: p.data.centerId, orgUnitId, weekday: p.data.weekday, date, audience: p.data.audience, mode: p.data.mode, text: p.data.text, isActive: p.data.isActive };
  if (p.data.id) {
    const existing = await sdb.shiftBriefNote.findUnique({ where: { id: p.data.id }, select: { centerId: true } });
    if (!existing) return { ok: false, error: "Không tìm thấy ghi chú" };
    if (!(await checkPermission("hr_attendance:assign", { centerId: existing.centerId }))) return { ok: false, error: "Không có quyền" };
    await sdb.shiftBriefNote.update({ where: { id: p.data.id }, data });
  } else {
    await sdb.shiftBriefNote.create({ data });
  }
  revalidatePath("/cham-cong/ghi-chu");
  return { ok: true };
}

export async function deleteBriefNoteAction(id: string): Promise<Res> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: "Chưa đăng nhập" };
  const actor = await resolveActor(session.user.id);
  const sdb = scopedDb(actor);
  // Đọc ĐỦ nội dung trước khi xoá, không chỉ `centerId`: đây là XOÁ CỨNG (`ShiftBriefNote` không
  // có `deletedAt`), nên nếu không chép lại vào nhật ký thì dữ liệu mất là mất hẳn — không tra
  // được ai xoá, xoá cái gì, lúc nào. Hai bước xác nhận ở UI chỉ giảm bấm nhầm, không thay được
  // dấu vết.
  const existing = await sdb.shiftBriefNote.findUnique({
    where: { id },
    select: { centerId: true, weekday: true, date: true, audience: true, mode: true, text: true, isActive: true },
  });
  if (!existing) return { ok: false, error: "Không tìm thấy ghi chú" };
  if (!(await checkPermission("hr_attendance:assign", { centerId: existing.centerId }))) return { ok: false, error: "Không có quyền" };
  await sdb.shiftBriefNote.delete({ where: { id } });
  await writeAudit({
    actor: { id: session.user.id, name: session.user.name ?? "" },
    module: "hr_attendance",
    entityType: "ShiftBriefNote",
    entityId: id,
    action: "DELETE",
    oldValues: {
      centerId: existing.centerId,
      weekday: existing.weekday,
      date: existing.date,
      audience: existing.audience,
      mode: existing.mode,
      text: existing.text,
      isActive: existing.isActive,
    },
  });
  revalidatePath("/cham-cong/ghi-chu");
  return { ok: true };
}
