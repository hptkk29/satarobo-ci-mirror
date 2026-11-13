// lib/parttime/don-vi-tiet-db.ts — ĐỌC ghi đè Q1 (`TeachingUnitPolicyOverride`) + định danh buổi theo bốn phạm vi. Chỉ đọc.
// Luật chọn ở `don-vi-tiet.ts` (thuần). Bảng là CHÍNH SÁCH (nhỏ, toàn hệ thống) — đọc cả bảng một lượt; prod phát hành rỗng.
// KHÔNG `server-only`: công cụ cutover (`scripts/parttime-cutover.ts`, chạy bằng tsx) đọc qua đây. Chỉ đọc bảng chính sách.
import { db } from "@/lib/db";
import type { GhiDeDonVi, KhoaBuoi } from "./don-vi-tiet";

const ymd = (d: Date) => d.toISOString().slice(0, 10);

export async function docGhiDeDonVi(): Promise<GhiDeDonVi[]> {
  const rows = await db.teachingUnitPolicyOverride.findMany({
    select: { id: true, scopeType: true, scopeId: true, effectiveFrom: true, effectiveTo: true, teachingDurationMinutes: true, teachingUnits: true, policyVersionId: true },
  });
  return rows.map((r) => ({
    id: r.id,
    scopeType: r.scopeType,
    scopeId: r.scopeId,
    effectiveFrom: ymd(r.effectiveFrom),
    effectiveTo: r.effectiveTo ? ymd(r.effectiveTo) : null,
    teachingDurationMinutes: r.teachingDurationMinutes,
    teachingUnits: r.teachingUnits.toFixed(2),
    policyVersionId: r.policyVersionId,
  }));
}

/** Định danh buổi (khoá `sourceType:sourceId`) cho các phân công — chỉ gọi khi CÓ ghi đè. Trial không có tiết (tách riêng). */
export async function khoaBuoiCua(pcs: readonly { sourceType: string; sourceId: string }[]): Promise<Map<string, KhoaBuoi>> {
  const ids = (t: string) => [...new Set(pcs.filter((x) => x.sourceType === t).map((x) => x.sourceId))];
  const [lop, bu] = await Promise.all([
    ids("CLASS_SESSION").length
      ? db.classSession.findMany({ where: { id: { in: ids("CLASS_SESSION") } }, select: { id: true, classId: true, class: { select: { courseId: true } }, sessionCategory: { select: { code: true } } } })
      : [],
    ids("MAKEUP_CASE").length ? db.makeupCase.findMany({ where: { id: { in: ids("MAKEUP_CASE") } }, select: { id: true, courseId: true, sessionCategoryId: true } }) : [],
  ]);
  // MakeupCase không có quan hệ tới SessionCategory (chỉ id) ⇒ tra mã loại buổi riêng.
  const loaiIds = [...new Set(bu.map((c) => c.sessionCategoryId).filter((x): x is string => !!x))];
  const loai = loaiIds.length ? new Map((await db.sessionCategory.findMany({ where: { id: { in: loaiIds } }, select: { id: true, code: true } })).map((c) => [c.id, c.code])) : new Map<string, string>();
  const ra = new Map<string, KhoaBuoi>();
  for (const s of lop) ra.set(`CLASS_SESSION:${s.id}`, { sessionId: s.id, classId: s.classId, courseId: s.class.courseId, sessionType: s.sessionCategory?.code ?? null });
  for (const c of bu) ra.set(`MAKEUP_CASE:${c.id}`, { sessionId: c.id, classId: null, courseId: c.courseId, sessionType: (c.sessionCategoryId && loai.get(c.sessionCategoryId)) || null });
  return ra;
}
