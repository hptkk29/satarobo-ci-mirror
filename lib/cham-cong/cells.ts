// lib/cham-cong/cells.ts — Sửa MỘT ô lưới tháng (MANUAL / SWAP / LEAVE): huỷ ca ACTIVE cũ, tạo ca
// mới đã resolve nơi làm, xếp hàng tính lại, trả before/after để thông báo (T-07).
// Không "use server" — action ở app/ gọi sau khi đã kiểm quyền theo cơ sở.
import type { Prisma, PrismaClient } from "@prisma/client";
import type { PlaceToken, ShiftSegment } from "./catalog";
import { resolvePlace, type CenterMap } from "./place";
import { markAttendanceDayDirty } from "./recompute";

export type CellDb = Pick<PrismaClient, "shiftTemplate" | "shiftAssignment">;

export type SetCellResult = {
  before: { id: string; templateCode: string; centerId: string; source: string } | null;
  after: { id: string; templateCode: string; centerId: string } | null;
  changed: boolean;
  error?: string;
};

export async function setAssignmentCell(opts: {
  db: CellDb;
  userId: string;
  workDate: Date;
  /** null = xoá ca (ô trống). */
  code: string | null;
  /** Khối chịu công khi mã không tự nói ("CS1"/"CS2"/"HO"). */
  homeUnit: string;
  centerMap: CenterMap;
  source: "MANUAL" | "SWAP" | "LEAVE" | "HOLIDAY";
  sourceRequestId?: string | null;
  note?: string | null;
  actorUserId: string;
  /** Quyền theo cơ sở — kiểm CẢ ca cũ lẫn ca mới. */
  canWriteCenter: (centerId: string) => boolean;
  tx?: Prisma.TransactionClient;
}): Promise<SetCellResult> {
  const db = (opts.tx ?? opts.db) as CellDb;
  const existing = await db.shiftAssignment.findFirst({
    where: { userId: opts.userId, workDate: opts.workDate, status: "ACTIVE" },
    select: { id: true, templateCode: true, centerId: true, source: true },
  });
  // `id` (đợt 11 đơn từ): huỷ đơn đã duyệt khôi phục ĐÚNG ô này — không đoán theo mã ca.
  const before = existing ? { id: existing.id, templateCode: existing.templateCode, centerId: existing.centerId, source: existing.source } : null;
  if (existing && !opts.canWriteCenter(existing.centerId)) return { before, after: null, changed: false, error: "Không có quyền sửa ca ở cơ sở này" };

  if (!opts.code) {
    if (!existing) return { before: null, after: null, changed: false };
    await db.shiftAssignment.updateMany({ where: { id: existing.id }, data: { status: "CANCELLED", note: opts.note ?? undefined } });
    await markAttendanceDayDirty(opts.userId, opts.workDate, { tx: opts.tx, reason: opts.source });
    return { before, after: null, changed: true };
  }

  const t = await db.shiftTemplate.findFirst({
    where: { code: opts.code, isActive: true, centerId: null },
    select: { id: true, code: true, segments: true, defaultPlace: true, attendanceMode: true, dayCredit: true, isLeave: true, nominalMinutes: true, soCapQuetKyVong: true },
  });
  if (!t) return { before, after: null, changed: false, error: `Mã ca "${opts.code}" không có trong danh mục` };
  const place = resolvePlace({ segments: (t.segments as ShiftSegment[] | null) ?? [], defaultPlace: t.defaultPlace as PlaceToken, homeUnit: opts.homeUnit, map: opts.centerMap });
  if (!opts.canWriteCenter(place.centerId)) return { before, after: null, changed: false, error: "Không có quyền xếp ca ở cơ sở này" };
  if (existing && existing.templateCode === t.code && existing.centerId === place.centerId && existing.source === opts.source) {
    return { before, after: { id: existing.id, templateCode: existing.templateCode, centerId: existing.centerId }, changed: false };
  }
  if (existing) await db.shiftAssignment.updateMany({ where: { id: existing.id }, data: { status: "CANCELLED" } });
  const orgUnitId = place.centerId === opts.centerMap.hoCenterId ? null : (Object.values(opts.centerMap.byCode).find((c) => c.centerId === place.centerId)?.orgUnitId ?? null);
  const created = await db.shiftAssignment.create({
    data: {
      userId: opts.userId,
      centerId: place.centerId,
      orgUnitId,
      workDate: opts.workDate,
      templateId: t.id,
      templateCode: t.code,
      segments: place.segments as unknown as Prisma.InputJsonValue,
      placeMode: place.placeMode,
      allowedOrgUnitIds: place.allowedOrgUnitIds,
      attendanceMode: t.attendanceMode,
      soCapQuetKyVong: t.soCapQuetKyVong,
      dayCredit: t.dayCredit,
      isLeave: t.isLeave,
      nominalMinutes: t.nominalMinutes,
      sourceCells: { [opts.homeUnit]: t.code } as Prisma.InputJsonValue,
      source: opts.source,
      sourceRequestId: opts.sourceRequestId ?? null,
      note: opts.note ?? null,
      createdById: opts.actorUserId,
    },
    select: { id: true, templateCode: true, centerId: true },
  });
  await markAttendanceDayDirty(opts.userId, opts.workDate, { tx: opts.tx, reason: opts.source });
  return { before, after: created, changed: true };
}
