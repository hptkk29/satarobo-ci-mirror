"use server";

// app/(admin)/admin/cham-cong/danh-muc-ca/_actions.ts — L3: danh mục mã ca (ShiftTemplate) CRUD.
// PHẦN 6b: giờ ca, số công, nơi làm, chế độ chấm… là DỮ LIỆU người vận hành sửa được, không
// phải hằng số. Quyền `hr_attendance:config`: mã dùng chung (centerId null) cần GLOBAL (Hội sở /
// SUPER_ADMIN); mã riêng cơ sở cần quyền tại cơ sở đó.
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { checkPermission } from "@/lib/auth/check-permission";
import { resolveActor } from "@/lib/auth/actor";
import { scopedDb } from "@/lib/db-scope";
import { writeAudit } from "@/lib/audit/audit-log";
import { toMinutes, validateSegments, type ShiftSegment } from "@/lib/cham-cong/catalog";
import { khaiDuocHaiCap } from "@/lib/cham-cong/cum-quet";
import { HO_CENTER_ID } from "@/lib/cham-cong/home-center";

type Res = { ok: true; id: string } | { ok: false; error: string };

const segmentSchema = z.object({
  start: z.string().regex(/^\d{2}:\d{2}$/, "Giờ dạng HH:mm"),
  end: z.string().regex(/^\d{2}:\d{2}$/, "Giờ dạng HH:mm"),
  kind: z.enum(["WORK", "PAID_BREAK"]),
  place: z.string().optional(),
});

const schema = z.object({
  code: z.string().trim().min(1, "Thiếu mã").max(8, "Mã tối đa 8 ký tự").regex(/^[A-Z0-9]+$/, "Mã chỉ gồm chữ hoa/số").transform((s) => s.toUpperCase()),
  name: z.string().trim().min(1, "Thiếu tên").max(80),
  kind: z.enum(["TIMED", "LOCATION_ONLY", "FLEXIBLE", "OFF", "LEAVE"]),
  segments: z.array(segmentSchema).max(6),
  defaultPlace: z.string().trim().min(1).default("HOME"),
  attendanceMode: z.enum(["REQUIRED", "OPTIONAL", "NONE"]),
  dayCredit: z.coerce.number().min(0).max(3),
  isLeave: z.coerce.boolean().default(false),
  nominalMinutes: z.coerce.number().int().min(0).max(24 * 60).nullable().default(null),
  payMode: z.enum(["SHIFT", "ADMIN_HOURS", "NONE"]),
  /**
   * Số CẶP quét đòi trong ngày — 0 / 1 / 2. Đưa lên màn 22/09/2026 cùng đợt HC đảo 1 → 2.
   *
   * KHÔNG `.default()`: trường này quyết định có gắn cờ thiếu lượt hay không (luật 7 — tham
   * số có mặc định nguy hiểm thì bỏ mặc định, để `tsc` liệt kê call site). Cột DB có
   * `@default(1)` cho dữ liệu cũ; đường GHI thì phải nói rõ.
   */
  soCapQuetKyVong: z.union([z.literal(0), z.literal(1), z.literal(2)]),
  scopeUserIds: z.array(z.string()).default([]),
  note: z.string().trim().max(500).nullable().default(null),
  isActive: z.coerce.boolean().default(true),
  centerId: z.string().nullable().default(null),
});

export type ShiftTemplateInput = z.input<typeof schema>;

function parse(input: unknown): { ok: true; data: z.infer<typeof schema> } | { ok: false; error: string } {
  const p = schema.safeParse(input);
  if (!p.success) return { ok: false, error: p.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" };
  const issues = validateSegments(p.data.segments as ShiftSegment[]);
  if (issues.length) return { ok: false, error: `Đoạn ca ${issues[0].index + 1}: ${issues[0].message}` };
  if (p.data.kind === "TIMED" && p.data.segments.length === 0) return { ok: false, error: "Mã có giờ phải có ít nhất một đoạn ca" };
  // Khai 2 cặp quét cho một ca không có khoảng hở nào là danh mục SAI: `cumQuetKyVong` sẽ
  // trả về MỘT cụm (nó cố ý không bịa cụm thứ hai), nên người vận hành chọn "2 lần" rồi
  // tưởng đã siết, mà hành vi không đổi gì. Nói thẳng ở đây thay vì để nó im lặng vô hiệu.
  if (p.data.soCapQuetKyVong === 2) {
    const work = (p.data.segments as ShiftSegment[])
      .filter((x) => x.kind === "WORK")
      .map((x) => ({ start: toMinutes(x.start), end: toMinutes(x.end) }));
    if (!khaiDuocHaiCap(work)) {
      return { ok: false, error: "Chọn 2 lần chấm thì ca phải có nghỉ giữa giờ KHÔNG tính công (hai đoạn làm việc rời nhau) — VD 08:00–11:30 và 13:30–17:30" };
    }
  }
  if ((p.data.kind === "OFF" || p.data.kind === "LEAVE") && p.data.dayCredit !== 0) return { ok: false, error: "Mã nghỉ phải có số công = 0" };
  return { ok: true, data: p.data };
}

async function gate(centerId: string | null): Promise<boolean> {
  return checkPermission("hr_attendance:config", { centerId: centerId ?? HO_CENTER_ID });
}

function displayCols(segments: ShiftSegment[]) {
  const am = segments.filter((s) => Number(s.start.slice(0, 2)) < 12);
  const pm = segments.filter((s) => Number(s.start.slice(0, 2)) >= 12);
  const br = segments.find((s) => s.kind === "PAID_BREAK");
  return {
    amStart: am[0]?.start ?? null,
    amEnd: am.length ? am[am.length - 1].end : null,
    pmStart: pm[0]?.start ?? null,
    pmEnd: pm.length ? pm[pm.length - 1].end : null,
    pmBreakStart: br?.start ?? null,
    pmBreakEnd: br?.end ?? null,
  };
}

export async function createShiftTemplateAction(input: unknown): Promise<Res> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: "Chưa đăng nhập" };
  const p = parse(input);
  if (!p.ok) return p;
  if (!(await gate(p.data.centerId))) return { ok: false, error: "Không có quyền sửa danh mục ca ở phạm vi này" };
  const actor = await resolveActor(session.user.id);
  const sdb = scopedDb(actor);
  const dup = await sdb.shiftTemplate.findFirst({ where: { code: p.data.code, effectiveTo: null }, select: { id: true } });
  if (dup) return { ok: false, error: `Mã "${p.data.code}" đã tồn tại` };
  const { segments, ...rest } = p.data;
  const created = await sdb.shiftTemplate.create({
    data: { ...rest, segments, ...displayCols(segments as ShiftSegment[]), displayOrder: (await sdb.shiftTemplate.count()) + 1 },
    select: { id: true },
  });
  await writeAudit({ actor: { id: session.user.id, name: session.user.name ?? "" }, module: "hr_attendance", entityType: "ShiftTemplate", entityId: created.id, action: "CREATE", newValues: p.data });
  revalidatePath("/cham-cong/danh-muc-ca");
  return { ok: true, id: created.id };
}

export async function updateShiftTemplateAction(id: string, input: unknown): Promise<Res> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: "Chưa đăng nhập" };
  const p = parse(input);
  if (!p.ok) return p;
  const actor = await resolveActor(session.user.id);
  const sdb = scopedDb(actor);
  const existing = await sdb.shiftTemplate.findUnique({ where: { id } });
  if (!existing) return { ok: false, error: "Không tìm thấy mã ca" };
  if (!(await gate(existing.centerId)) || !(await gate(p.data.centerId))) return { ok: false, error: "Không có quyền sửa danh mục ca ở phạm vi này" };
  if (p.data.code !== existing.code) {
    const used = await sdb.shiftAssignment.count({ where: { templateId: id } });
    if (used > 0) return { ok: false, error: `Mã đang được dùng ở ${used} ô lịch — không đổi mã được, tạo mã mới rồi ngưng mã này` };
  }
  const { segments, ...rest } = p.data;
  await sdb.shiftTemplate.update({ where: { id }, data: { ...rest, segments, ...displayCols(segments as ShiftSegment[]) } });
  await writeAudit({
    actor: { id: session.user.id, name: session.user.name ?? "" },
    module: "hr_attendance",
    entityType: "ShiftTemplate",
    entityId: id,
    action: "UPDATE",
    oldValues: { code: existing.code, name: existing.name, segments: existing.segments, dayCredit: existing.dayCredit, attendanceMode: existing.attendanceMode, isActive: existing.isActive },
    newValues: { code: p.data.code, name: p.data.name, segments, dayCredit: p.data.dayCredit, attendanceMode: p.data.attendanceMode, isActive: p.data.isActive },
    reason: "Sửa danh mục ca — lịch đã xếp giữ segments cũ (snapshot), chỉ ô xếp sau này dùng giờ mới",
  });
  revalidatePath("/cham-cong/danh-muc-ca");
  return { ok: true, id };
}

export async function toggleShiftTemplateAction(id: string, isActive: boolean): Promise<Res> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: "Chưa đăng nhập" };
  const actor = await resolveActor(session.user.id);
  const sdb = scopedDb(actor);
  const existing = await sdb.shiftTemplate.findUnique({ where: { id }, select: { centerId: true, code: true } });
  if (!existing) return { ok: false, error: "Không tìm thấy mã ca" };
  if (!(await gate(existing.centerId))) return { ok: false, error: "Không có quyền" };
  await sdb.shiftTemplate.update({ where: { id }, data: { isActive } });
  await writeAudit({ actor: { id: session.user.id, name: session.user.name ?? "" }, module: "hr_attendance", entityType: "ShiftTemplate", entityId: id, action: isActive ? "ACTIVATE" : "DEACTIVATE", newValues: { code: existing.code, isActive } });
  revalidatePath("/cham-cong/danh-muc-ca");
  return { ok: true, id };
}
