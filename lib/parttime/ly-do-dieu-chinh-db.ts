// lib/parttime/ly-do-dieu-chinh-db.ts — ĐỌC nguồn lý do điều chỉnh cho lưới / tệp xuất (PR7 lưới phân công GV, 25/10/2026). Theo lô.
// Nguồn và luật dịch: `ly-do-dieu-chinh.ts`. Nơi gọi đã kiểm quyền xem cơ sở.
import "server-only";
import { db } from "@/lib/db";
import { WR_KIND_LABEL, type WorkRequestKindV } from "@/lib/work-request";
import { docNhatKySuaTheoBuoi } from "./sua-buoi-da-qua-db";
import { tuChuyenDoi, tuDonTu, tuNhatKyTruc, tuSuaBuoi, type DieuChinh } from "./ly-do-dieu-chinh";

const ngayDate = (ymd: string) => new Date(`${ymd}T00:00:00Z`);
const ymd = (d: Date) => d.toISOString().slice(0, 10);

export type TrucDaHuy = { id: string; userId: string; ten: string; ngay: string; shiftCode: string; dieuChinh: DieuChinh[] };
export type DieuChinhCoSo = {
  /** assignmentId (phân công buổi) hoặc dutyId (dòng trực còn sống) → các điều chỉnh, mới nhất trước. */
  theoId: Map<string, DieuChinh[]>;
  /** Dòng trực ĐÃ HUỶ trong khoảng ngày — không còn trên lưới, nhưng là lý do PLAN khác ban đầu (vd. bỏ trực khi nhận học bù). */
  trucDaHuy: TrucDaHuy[];
};

export async function docDieuChinh(p: { centerId: string; tu: string; den: string; assignmentIds: readonly string[]; dutyIds: readonly string[] }): Promise<DieuChinhCoSo> {
  const [pc, trucHuy] = await Promise.all([
    p.assignmentIds.length
      ? db.sessionStaffAssignment.findMany({ where: { id: { in: [...p.assignmentIds] } }, select: { id: true, sourceId: true, assignmentType: true, sourceWorkRequestId: true } })
      : [],
    db.operationsDutyAssignment.findMany({
      where: { centerId: p.centerId, workDate: { gte: ngayDate(p.tu), lte: ngayDate(p.den) }, status: "CANCELLED" },
      select: { id: true, userId: true, workDate: true, shiftCode: true },
    }),
  ]);
  const dutyAll = [...p.dutyIds, ...trucHuy.map((t) => t.id)];
  const wrIds = [...new Set(pc.map((x) => x.sourceWorkRequestId).filter((x): x is string => x != null))];
  const [suaBuoi, don, nkTruc] = await Promise.all([
    docNhatKySuaTheoBuoi([...new Set(pc.map((x) => x.sourceId))]),
    wrIds.length
      ? db.workRequest.findMany({ where: { id: { in: wrIds } }, select: { id: true, kind: true, reason: true, requesterId: true, reviewedByName: true, reviewedAt: true, status: true } })
      : [],
    dutyAll.length
      ? db.auditLog.findMany({
          where: { entityType: "OperationsDutyAssignment", entityId: { in: dutyAll }, action: { in: ["PT_DUTY_KEPT_WITH_MAKEUP", "PT_DUTY_CANCELLED"] } },
          orderBy: { createdAt: "desc" },
          select: { id: true, entityId: true, action: true, reason: true, actorName: true, createdAt: true },
        })
      : [],
  ]);
  const canTen = [...new Set([...don.map((d) => d.requesterId), ...trucHuy.map((t) => t.userId)])];
  const nguoiGui = new Map(
    (canTen.length ? await db.user.findMany({ where: { id: { in: canTen } }, select: { id: true, name: true, email: true } }) : []).map((u) => [
      u.id,
      u.name ?? u.email ?? u.id,
    ]),
  );
  const donTheoId = new Map(don.map((d) => [d.id, d]));

  const theoId = new Map<string, DieuChinh[]>();
  const them = (id: string, d: DieuChinh) => theoId.set(id, [...(theoId.get(id) ?? []), d]);
  for (const x of pc) {
    for (const s of suaBuoi.get(x.sourceId) ?? []) them(x.id, tuSuaBuoi(s));
    const w = x.sourceWorkRequestId ? donTheoId.get(x.sourceWorkRequestId) : undefined;
    if (w) {
      them(
        x.id,
        tuDonTu({
          id: w.id,
          loai: WR_KIND_LABEL[w.kind as WorkRequestKindV] ?? w.kind,
          lyDo: w.reason,
          nguoiGui: nguoiGui.get(w.requesterId) ?? null,
          nguoiDuyet: w.reviewedByName,
          lucDuyet: w.reviewedAt?.toISOString() ?? null,
          trangThai: w.status,
        }),
      );
    }
    if (x.assignmentType === "CUTOVER" && !theoId.has(x.id)) them(x.id, tuChuyenDoi(x.id));
  }
  for (const a of nkTruc) {
    const d = tuNhatKyTruc({ id: a.id, action: a.action, reason: a.reason, actorName: a.actorName, createdAt: a.createdAt.toISOString() });
    if (d) them(a.entityId, d);
  }
  return {
    theoId,
    trucDaHuy: trucHuy.map((t) => ({ id: t.id, userId: t.userId, ten: nguoiGui.get(t.userId) ?? t.userId, ngay: ymd(t.workDate), shiftCode: t.shiftCode, dieuChinh: theoId.get(t.id) ?? [] })),
  };
}
