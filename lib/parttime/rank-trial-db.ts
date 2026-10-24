// lib/parttime/rank-trial-db.ts — GHI / ĐỌC đề xuất Rank, chứng nhận Trial, chính sách hỗ trợ Trial (lưới phân công GV · PR4).
// Luật ở `rank-trial-luat.ts` (thuần). Mỗi thao tác ghi: MỘT giao dịch, cổng luật đứng TRƯỚC phép ghi đầu tiên (luật rollback), audit
// trong cùng giao dịch. Quyền do nơi gọi (server action) kiểm — hàm này nhận `actor` đã qua cổng.
import "server-only";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { writeAudit } from "@/lib/audit/audit-log";
import { vnYmd } from "@/lib/time/vn";
import { docChinhSach } from "./phan-cong-db";
import { chinhSachTaiNgay } from "./chinh-sach";
import { rankTaiNgay } from "./rank";
import {
  chinhSachTrialTai,
  chungNhanHieuLucTai,
  keHoachDatChinhSachTrial,
  kiemCapChungNhan,
  kiemDeXuatRank,
  kiemQuyetRank,
  ngayCuoiKhiThuHoi,
  type DongChinhSachTrial,
  type KhoangChungNhan,
} from "./rank-trial-luat";

type Tx = Prisma.TransactionClient;
export type NguoiThaoTac = { id: string; name: string };
export type KetQua<T = object> = ({ ok: true } & T) | { ok: false; loi: string };

const MODULE = "hr_attendance";
const ngayDate = (ymd: string) => new Date(`${ymd}T00:00:00.000Z`);
const ymd = (d: Date) => d.toISOString().slice(0, 10);

/** Tháng ("YYYY-MM") có kỳ công ĐÃ KHOÁ ở cơ sở. */
async function kyKhoa(tx: Tx, centerId: string): Promise<Set<string>> {
  const rows = await tx.attendancePeriod.findMany({ where: { centerId, status: "LOCKED" }, select: { periodKey: true } });
  return new Set(rows.map((r) => r.periodKey));
}

/** Rank tại ngày `ngay` của một người — CÙNG hàm với chụp đơn giá ở P5 (`rankTaiNgay` + `rankMacDinh` của chính sách tại ngày). */
async function rankHienTai(tx: Tx, userId: string, ngay: string): Promise<number> {
  const [lichSu, chinhSach] = await Promise.all([
    tx.teacherRankHistory.findMany({ where: { userId }, select: { rank: true, effectiveFrom: true } }),
    docChinhSach(tx),
  ]);
  const cs = chinhSachTaiNgay(chinhSach, ngay);
  const macDinh = cs && cs.thamSo.loai === "SR_QD_238" ? cs.thamSo.rankMacDinh : 1;
  return rankTaiNgay(lichSu.map((r) => ({ rank: r.rank, hieuLucTu: ymd(r.effectiveFrom) })), ngay, macDinh).rank;
}

// ─── Rank ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────

export async function deXuatRank(
  tx: Tx,
  p: { userId: string; centerId: string; proposedRank: number; effectiveFrom: string; basis: string; actor: NguoiThaoTac; now: Date },
): Promise<KetQua<{ id: string }>> {
  const homNay = vnYmd(p.now);
  const [current, khoa, dangCho] = await Promise.all([
    rankHienTai(tx, p.userId, p.effectiveFrom),
    kyKhoa(tx, p.centerId),
    tx.teacherRankProposal.count({ where: { userId: p.userId, status: "PROPOSED" } }),
  ]);
  const loi = kiemDeXuatRank({ currentRank: current, proposedRank: p.proposedRank, effectiveFrom: p.effectiveFrom, basis: p.basis, homNay, kyDaKhoa: khoa, coDeXuatDangCho: dangCho > 0 });
  if (loi) return { ok: false, loi };
  const r = await tx.teacherRankProposal.create({
    // orgUnitId KHÔNG truyền: ghi kép (`lib/org/dual-write.ts`) tự điền từ centerId.
    data: { userId: p.userId, centerId: p.centerId, currentRank: current, proposedRank: p.proposedRank, effectiveFrom: ngayDate(p.effectiveFrom), basis: p.basis.trim(), proposedById: p.actor.id },
    select: { id: true, orgUnitId: true },
  });
  await writeAudit({
    actor: p.actor,
    module: MODULE,
    entityType: "TeacherRankProposal",
    entityId: r.id,
    action: "PT_RANK_PROPOSED",
    newValues: { userId: p.userId, currentRank: current, proposedRank: p.proposedRank, effectiveFrom: p.effectiveFrom },
    reason: p.basis.trim(),
    orgUnitId: r.orgUnitId,
    tx,
  });
  return { ok: true, id: r.id };
}

/** Duyệt ⇒ THÊM dòng `TeacherRankHistory` (Rank có hiệu lực từ ngày đề xuất); từ chối ⇒ chỉ đổi trạng thái. */
export async function quyetRank(tx: Tx, p: { id: string; duyet: boolean; ghiChu: string | null; actor: NguoiThaoTac; now: Date }): Promise<KetQua> {
  const d = await tx.teacherRankProposal.findUnique({ where: { id: p.id } });
  if (!d) return { ok: false, loi: "Không tìm thấy đề xuất." };
  const loi = kiemQuyetRank({
    status: d.status,
    effectiveFrom: ymd(d.effectiveFrom),
    homNay: vnYmd(p.now),
    kyDaKhoa: await kyKhoa(tx, d.centerId),
    nguoiQuyet: p.actor.id,
    nguoiDeXuat: d.proposedById,
    duyet: p.duyet,
  });
  if (loi) return { ok: false, loi };
  if (!p.duyet && (p.ghiChu ?? "").trim().length < 5) return { ok: false, loi: "Từ chối phải ghi lý do (tối thiểu 5 ký tự)." };
  // Chống đua: chỉ chuyển khi CÒN PROPOSED (hai người quyết cùng lúc ⇒ người sau đổi 0 dòng).
  const u = await tx.teacherRankProposal.updateMany({
    where: { id: p.id, status: "PROPOSED" },
    data: { status: p.duyet ? "APPROVED" : "REJECTED", decidedById: p.actor.id, decidedAt: p.now, decisionNote: p.ghiChu?.trim() || null },
  });
  if (u.count === 0) return { ok: false, loi: "Đề xuất vừa được người khác quyết — tải lại trang." };
  let rankHistoryId: string | null = null;
  if (p.duyet) {
    const trung = await tx.teacherRankHistory.findUnique({ where: { userId_effectiveFrom: { userId: d.userId, effectiveFrom: d.effectiveFrom } }, select: { id: true } });
    if (trung) throw new Error("RANK_TRUNG_NGAY"); // ném ⇒ rollback cả phép đổi trạng thái ở trên
    const h = await tx.teacherRankHistory.create({
      data: { userId: d.userId, rank: d.proposedRank, effectiveFrom: d.effectiveFrom, reason: `Đề xuất ${d.id}: ${d.basis}`.slice(0, 500), decidedById: p.actor.id },
      select: { id: true },
    });
    rankHistoryId = h.id;
    await tx.teacherRankProposal.update({ where: { id: p.id }, data: { rankHistoryId } });
  }
  await writeAudit({
    actor: p.actor,
    module: MODULE,
    entityType: "TeacherRankProposal",
    entityId: p.id,
    action: p.duyet ? "PT_RANK_APPROVED" : "PT_RANK_REJECTED",
    oldValues: { status: "PROPOSED" },
    newValues: { status: p.duyet ? "APPROVED" : "REJECTED", rankHistoryId, proposedRank: d.proposedRank, effectiveFrom: ymd(d.effectiveFrom) },
    reason: p.ghiChu ?? undefined,
    orgUnitId: d.orgUnitId,
    tx,
  });
  return { ok: true };
}

// ─── Chứng nhận Trial ─────────────────────────────────────────────────────────────────────────────────────────────────────

export async function capChungNhan(
  tx: Tx,
  p: { userId: string; code: string | null; effectiveFrom: string; note: string | null; actor: NguoiThaoTac; now: Date },
): Promise<KetQua<{ id: string }>> {
  const dangCo = await tx.trialCertificate.findMany({ where: { userId: p.userId }, select: { effectiveFrom: true, effectiveTo: true } });
  const loi = kiemCapChungNhan({ effectiveFrom: p.effectiveFrom, homNay: vnYmd(p.now), dangCo: dangCo.map((c) => ({ effectiveFrom: ymd(c.effectiveFrom), effectiveTo: c.effectiveTo ? ymd(c.effectiveTo) : null })) });
  if (loi) return { ok: false, loi };
  const c = await tx.trialCertificate.create({
    data: { userId: p.userId, code: p.code?.trim() || null, effectiveFrom: ngayDate(p.effectiveFrom), issuedById: p.actor.id, note: p.note?.trim() || null },
    select: { id: true },
  });
  await writeAudit({ actor: p.actor, module: MODULE, entityType: "TrialCertificate", entityId: c.id, action: "PT_TRIAL_CERT_ISSUED", newValues: { userId: p.userId, code: p.code, effectiveFrom: p.effectiveFrom }, tx });
  return { ok: true, id: c.id };
}

/** Thu hồi TỪ ngày `tuNgay` (≥ hôm nay): ngày cuối hiệu lực = tuNgay − 1. Buổi Trial trước đó vẫn hợp lệ — không xoá dòng. */
export async function thuHoiChungNhan(tx: Tx, p: { id: string; tuNgay: string; lyDo: string; actor: NguoiThaoTac; now: Date }): Promise<KetQua> {
  if (p.lyDo.trim().length < 5) return { ok: false, loi: "Ghi lý do thu hồi (tối thiểu 5 ký tự)." };
  if (p.tuNgay < vnYmd(p.now)) return { ok: false, loi: "Không thu hồi lùi về quá khứ — buổi Trial đã dạy khi chứng nhận còn hiệu lực vẫn được tính." };
  const c = await tx.trialCertificate.findUnique({ where: { id: p.id } });
  if (!c) return { ok: false, loi: "Không tìm thấy chứng nhận." };
  if (c.revokedAt) return { ok: false, loi: "Chứng nhận đã bị thu hồi." };
  const cuoi = ngayCuoiKhiThuHoi(p.tuNgay);
  const cuoiCu = c.effectiveTo ? ymd(c.effectiveTo) : null;
  if (cuoiCu != null && cuoiCu <= cuoi) return { ok: false, loi: `Chứng nhận vốn đã hết hiệu lực ngày ${cuoiCu}.` };
  const moiTo = cuoi < ymd(c.effectiveFrom) ? ngayCuoiKhiThuHoi(ymd(c.effectiveFrom)) : cuoi;
  const u = await tx.trialCertificate.updateMany({
    where: { id: p.id, revokedAt: null },
    data: { effectiveTo: ngayDate(moiTo), revokedAt: p.now, revokedById: p.actor.id, revokeReason: p.lyDo.trim() },
  });
  if (u.count === 0) return { ok: false, loi: "Chứng nhận vừa thay đổi — tải lại trang." };
  await writeAudit({ actor: p.actor, module: MODULE, entityType: "TrialCertificate", entityId: p.id, action: "PT_TRIAL_CERT_REVOKED", oldValues: { effectiveTo: cuoiCu }, newValues: { effectiveTo: moiTo, tuNgay: p.tuNgay }, reason: p.lyDo.trim(), tx });
  return { ok: true };
}

// ─── Chính sách hỗ trợ Trial ──────────────────────────────────────────────────────────────────────────────────────────────

const sangDong = (r: { id: string; centerId: string | null; enabled: boolean; amountPerStudent: number; effectiveFrom: Date; effectiveTo: Date | null }): DongChinhSachTrial => ({
  id: r.id,
  centerId: r.centerId,
  enabled: r.enabled,
  amountPerStudent: r.amountPerStudent,
  effectiveFrom: ymd(r.effectiveFrom),
  effectiveTo: r.effectiveTo ? ymd(r.effectiveTo) : null,
});

export async function datChinhSachTrial(
  tx: Tx,
  p: { centerId: string | null; enabled: boolean; amountPerStudent: number; effectiveFrom: string; reason: string; actor: NguoiThaoTac; now: Date },
): Promise<KetQua<{ id: string }>> {
  if (p.reason.trim().length < 10) return { ok: false, loi: "Ghi lý do / căn cứ phê duyệt (tối thiểu 10 ký tự)." };
  if (!Number.isInteger(p.amountPerStudent) || p.amountPerStudent < 0 || p.amountPerStudent > 1_000_000) return { ok: false, loi: "Mức hỗ trợ phải là số nguyên VND từ 0 đến 1.000.000." };
  // Khoá tư vấn theo phạm vi: hai người đặt cùng lúc không đẻ hai dòng chồng ngày.
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`trial-support-policy:${p.centerId ?? "TOAN_HE_THONG"}`}))`;
  const ds = (await tx.trialSupportPolicy.findMany({ where: { centerId: p.centerId } })).map(sangDong);
  const kh = keHoachDatChinhSachTrial({ ds, centerId: p.centerId, effectiveFrom: p.effectiveFrom, homNay: vnYmd(p.now) });
  if (!kh.ok) return { ok: false, loi: kh.loi };
  for (const d of kh.dong) await tx.trialSupportPolicy.update({ where: { id: d.id }, data: { effectiveTo: ngayDate(d.effectiveTo) } });
  const r = await tx.trialSupportPolicy.create({
    data: { centerId: p.centerId, enabled: p.enabled, amountPerStudent: p.amountPerStudent, effectiveFrom: ngayDate(p.effectiveFrom), reason: p.reason.trim(), approvedById: p.actor.id },
    select: { id: true, orgUnitId: true },
  });
  await writeAudit({
    actor: p.actor,
    module: MODULE,
    entityType: "TrialSupportPolicy",
    entityId: r.id,
    action: "PT_TRIAL_POLICY_SET",
    newValues: { centerId: p.centerId, enabled: p.enabled, amountPerStudent: p.amountPerStudent, effectiveFrom: p.effectiveFrom, dong: kh.dong },
    reason: p.reason.trim(),
    orgUnitId: r.orgUnitId,
    tx,
  });
  return { ok: true, id: r.id };
}

// ─── Đọc cho lưới (theo lô) ───────────────────────────────────────────────────────────────────────────────────────────────

/** Nguồn cho cổng hỗ trợ Trial: chứng nhận của các người + mọi dòng chính sách (bảng nhỏ, đọc cả bảng). */
export async function docNguonHoTroTrial(userIds: readonly string[]): Promise<{
  chungNhanTai: (userId: string, ngay: string) => boolean;
  chinhSachTai: (centerId: string, ngay: string) => { bat: boolean; mucMoiHocVien: number } | null;
}> {
  const [cn, cs] = await Promise.all([
    userIds.length ? db.trialCertificate.findMany({ where: { userId: { in: [...userIds] } }, select: { userId: true, effectiveFrom: true, effectiveTo: true } }) : [],
    db.trialSupportPolicy.findMany(),
  ]);
  const theoNguoi = new Map<string, KhoangChungNhan[]>();
  for (const c of cn) theoNguoi.set(c.userId, [...(theoNguoi.get(c.userId) ?? []), { effectiveFrom: ymd(c.effectiveFrom), effectiveTo: c.effectiveTo ? ymd(c.effectiveTo) : null }]);
  const dong = cs.map(sangDong);
  return {
    chungNhanTai: (userId, ngay) => chungNhanHieuLucTai(theoNguoi.get(userId) ?? [], ngay),
    chinhSachTai: (centerId, ngay) => {
      try {
        const r = chinhSachTrialTai(dong, centerId, ngay);
        return r ? { bat: r.bat, mucMoiHocVien: r.mucMoiHocVien } : null;
      } catch (e) {
        // Cấu hình chồng ngày: không đoán dòng nào thắng ⇒ coi như chưa có chính sách (0đ + lý do), ghi log để Hội sở sửa.
        console.error("[parttime] chính sách hỗ trợ Trial chồng ngày", e instanceof Error ? e.message : e);
        return null;
      }
    },
  };
}
