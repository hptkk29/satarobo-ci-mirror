// lib/parttime/truc-van-hanh-db.ts — P5b · GHI / ĐỌC trực vận hành tường minh + xác nhận đơn vị trả (OPERATIONS_DUTY).
//
// Nơi gọi (server action) đã kiểm quyền: QLCS = `hr_attendance:assign` ở cơ sở trực; người trực = `userId` từ PHIÊN.
// Đơn vị trả tính bằng MỘT hàm `danhGiaTruc`; tiết dạy trong ca lấy từ đối soát P5a (`docDoiSoatThucHien`, CÙNG định nghĩa
// với màn xác nhận dạy) — không đếm lại tiết theo đường thứ hai. Không đọc ShiftAssignment ở bất kỳ đâu (D-Q3).
import "server-only";
import { Prisma, type AssignmentDecision } from "@prisma/client";
import { db } from "@/lib/db";
import { writeAudit } from "@/lib/audit/audit-log";
import { LUOT_CON_TINH } from "@/lib/cham-cong/sua-gio-quet";
import { khoangCoMatTrongNgay } from "./bang-chung-cong";
import { dungSaiTheoCoSo } from "./bang-chung-cong-db";
import { chinhSachTaiNgay } from "./chinh-sach";
import { docChinhSach, type NguoiThaoTac } from "./phan-cong-db";
import { danhGiaTruc, dauVanTruc, type DanhGiaTruc, type DauVaoTruc, type LopTruc, type TietTrongNgay } from "./truc-van-hanh";
import { docDoiSoatThucHien } from "./workunit-db";
import { kiemXacNhan, trangThaiHieuLuc, type LopUngVien, type QuyetDinhThucHien } from "./workunit";

type Tx = Prisma.TransactionClient;
const MODULE = "hr_attendance";
const ENTITY = "OperationsDutyAssignment";
export const HANH_DONG_TRUC = {
  TAO: "PT_DUTY_CREATED",
  HUY: "PT_DUTY_CANCELLED",
  NHAN: "PT_DUTY_ACCEPTED",
  TU_CHOI: "PT_DUTY_DECLINED",
} as const;
const SONG = ["PROPOSED", "WAITING_ACCEPTANCE", "ACCEPTED", "ACTIVE", "COMPLETED"] as const;
const ngayDate = (ymd: string) => new Date(`${ymd}T00:00:00Z`);
const ymd = (d: Date) => d.toISOString().slice(0, 10);

export type KetQua<T = object> = ({ ok: true } & T) | { ok: false; loi: string };

// ─── Giao / huỷ / nhận ──────────────────────────────────────────────────────────────────────

export async function giaoTruc(
  tx: Tx,
  p: { userId: string; centerId: string; ngay: string; shiftCode: string; note: string | null; actor: NguoiThaoTac },
): Promise<KetQua<{ id: string }>> {
  const cs = chinhSachTaiNgay(await docChinhSach(tx), p.ngay);
  if (!cs || cs.thamSo.loai !== "SR_QD_238") return { ok: false, loi: "Ngày này không thuộc SR.QD.238 — không giao trực." };
  if (!cs.thamSo.ca.some((c) => c.ma === p.shiftCode)) return { ok: false, loi: `Ca "${p.shiftCode}" không có trong chính sách tại ngày này.` };
  const trung = await tx.operationsDutyAssignment.findFirst({ where: { userId: p.userId, workDate: ngayDate(p.ngay), shiftCode: p.shiftCode, status: { in: [...SONG] } }, select: { id: true } });
  if (trung) return { ok: false, loi: "Người này đã được giao trực ca này rồi." };
  const d = await tx.operationsDutyAssignment.create({
    // orgUnitId KHÔNG truyền: ghi kép (`lib/org/dual-write.ts`) tự điền từ centerId — truyền `null` là chặn nó.
    data: { userId: p.userId, centerId: p.centerId, workDate: ngayDate(p.ngay), shiftCode: p.shiftCode, policyVersionId: cs.id, assignedById: p.actor.id, note: p.note },
    select: { id: true, orgUnitId: true },
  });
  await writeAudit({ actor: p.actor, module: MODULE, entityType: ENTITY, entityId: d.id, action: HANH_DONG_TRUC.TAO, newValues: { userId: p.userId, ngay: p.ngay, shiftCode: p.shiftCode, centerId: p.centerId }, orgUnitId: d.orgUnitId, tx });
  return { ok: true, id: d.id };
}

export async function huyTruc(tx: Tx, p: { dutyId: string; lyDo: string; actor: NguoiThaoTac }): Promise<KetQua> {
  const d = await tx.operationsDutyAssignment.findUnique({ where: { id: p.dutyId }, select: { status: true, orgUnitId: true } });
  if (!d) return { ok: false, loi: "Không tìm thấy dòng trực." };
  if (!(SONG as readonly string[]).includes(d.status)) return { ok: false, loi: "Dòng trực đã không còn hiệu lực." };
  const u = await tx.operationsDutyAssignment.updateMany({ where: { id: p.dutyId, status: d.status }, data: { status: "CANCELLED" } });
  if (u.count === 0) return { ok: false, loi: "Dòng trực vừa thay đổi — tải lại trang." };
  await writeAudit({ actor: p.actor, module: MODULE, entityType: ENTITY, entityId: p.dutyId, action: HANH_DONG_TRUC.HUY, oldValues: { status: d.status }, newValues: { status: "CANCELLED" }, reason: p.lyDo, orgUnitId: d.orgUnitId, tx });
  return { ok: true };
}

/** Người trực tự nhận / từ chối (KHÔNG có đường nhận thay). Chỉ trước khi ca kết thúc. */
export async function quyetDinhTruc(
  tx: Tx,
  p: { dutyId: string; nguoiBam: { id: string; name: string }; quyetDinh: AssignmentDecision; phienBanDaXem: number; lyDo: string | null; now: Date },
): Promise<KetQua> {
  const d = await tx.operationsDutyAssignment.findUnique({ where: { id: p.dutyId } });
  if (!d) return { ok: false, loi: "Không tìm thấy dòng trực." };
  if (d.userId !== p.nguoiBam.id) return { ok: false, loi: "Chỉ người được giao mới nhận / từ chối được trực này." };
  if (d.status !== "WAITING_ACCEPTANCE") return { ok: false, loi: "Dòng trực không ở trạng thái chờ xác nhận." };
  if (d.assignmentVersion !== p.phienBanDaXem) return { ok: false, loi: "Dòng trực vừa thay đổi — tải lại trang." };
  const lyDo = p.lyDo?.trim() ?? "";
  if (p.quyetDinh === "DECLINED" && lyDo.length < 5) return { ok: false, loi: "Ghi lý do từ chối (tối thiểu 5 ký tự)." };
  const cs = chinhSachTaiNgay(await docChinhSach(tx), ymd(d.workDate));
  const ca = cs && cs.thamSo.loai === "SR_QD_238" ? cs.thamSo.ca.find((c) => c.ma === d.shiftCode) : null;
  if (!ca) return { ok: false, loi: "Ca trực không còn trong chính sách." };
  if (p.now.getTime() >= new Date(`${ymd(d.workDate)}T${ca.den}:00+07:00`).getTime()) return { ok: false, loi: "Ca trực đã kết thúc — không nhận được nữa." };
  const u = await tx.operationsDutyAssignment.updateMany({ where: { id: d.id, status: "WAITING_ACCEPTANCE", assignmentVersion: d.assignmentVersion }, data: { status: p.quyetDinh } });
  if (u.count === 0) return { ok: false, loi: "Dòng trực vừa thay đổi — tải lại trang." };
  await tx.operationsDutyAcceptance.create({
    data: { dutyId: d.id, assignmentVersion: d.assignmentVersion, userId: d.userId, decision: p.quyetDinh, decisionNote: lyDo || null, decidedAt: p.now, centerId: d.centerId, orgUnitId: d.orgUnitId },
  });
  await writeAudit({ actor: p.nguoiBam, module: MODULE, entityType: ENTITY, entityId: d.id, action: p.quyetDinh === "ACCEPTED" ? HANH_DONG_TRUC.NHAN : HANH_DONG_TRUC.TU_CHOI, newValues: { phienBan: d.assignmentVersion }, reason: lyDo || undefined, orgUnitId: d.orgUnitId, tx });
  return { ok: true };
}

// ─── Đọc ────────────────────────────────────────────────────────────────────────────────────

const CHON_TRUC = {
  id: true,
  userId: true,
  centerId: true,
  orgUnitId: true,
  workDate: true,
  shiftCode: true,
  status: true,
  assignmentVersion: true,
  acceptances: { select: { assignmentVersion: true, decision: true } },
} satisfies Prisma.OperationsDutyAssignmentSelect;
type TrucDoc = Prisma.OperationsDutyAssignmentGetPayload<{ select: typeof CHON_TRUC }>;

export type DongTruc = {
  dutyId: string;
  userId: string;
  centerId: string;
  ngay: string;
  shiftCode: string;
  status: string;
  phienBan: number;
  danhGia: DanhGiaTruc;
  dauVan: string;
  policyVersionId: string | null;
  kyKhoa: boolean;
  xacNhan: { decision: string; reason: string | null; decidedAt: Date } | null;
  donVi: { id: string; quantity: string; rateSnapshot: number; status: "CONFIRMED" | "STALE" | "VOIDED"; hieuLuc: "CONFIRMED" | "STALE" | "VOIDED" } | null;
};

/**
 * Trực của MỘT cơ sở × khoảng ngày (mọi trạng thái — dòng huỷ hiện KHONG_AP_DUNG). Số câu tra không phụ thuộc số dòng trực:
 * tiết dạy đọc bằng đối soát P5a theo TỪNG CƠ SỞ có tiết (số cơ sở, không phải số tiết).
 */
export async function docTrucCoSo(p: { centerId: string; tu: string; den: string; now: Date }): Promise<DongTruc[]> {
  const truc = await db.operationsDutyAssignment.findMany({
    where: { centerId: p.centerId, workDate: { gte: ngayDate(p.tu), lte: ngayDate(p.den) } },
    orderBy: [{ workDate: "asc" }, { shiftCode: "asc" }],
    select: CHON_TRUC,
  });
  return danhGiaDanhSach(truc, p);
}

async function danhGiaDanhSach(truc: TrucDoc[], p: { tu: string; den: string; now: Date }): Promise<DongTruc[]> {
  if (!truc.length) return [];
  const nguoi = [...new Set(truc.map((t) => t.userId))];
  const thang = [...new Set([p.tu.slice(0, 7), p.den.slice(0, 7)])];
  const [chinhSach, tietPc, luot, donViRaw, xacNhanRaw, kyKhoaRaw, dungSai] = await Promise.all([
    docChinhSach(),
    db.sessionStaffAssignment.findMany({
      where: { userId: { in: nguoi }, ngay: { gte: ngayDate(p.tu), lte: ngayDate(p.den) }, role: { in: ["MAIN_TEACHER", "TEACHING_ASSISTANT"] } },
      select: { centerId: true },
      distinct: ["centerId"],
    }),
    db.staffTimeLog.findMany({ where: { userId: { in: nguoi }, workDate: { gte: ngayDate(p.tu), lte: ngayDate(p.den) }, ...LUOT_CON_TINH }, select: { id: true, userId: true, workDate: true, loggedAt: true, direction: true, centerId: true, flags: true } }),
    db.workUnit.findMany({ where: { assignmentId: { in: truc.map((t) => t.id) }, workUnitType: "OPERATIONS_DUTY", status: { not: "VOIDED" } }, select: { id: true, assignmentId: true, assignmentVersion: true, evidenceFingerprint: true, status: true, quantity: true, rateSnapshot: true } }),
    db.workConfirmation.findMany({ where: { assignmentId: { in: truc.map((t) => t.id) } }, orderBy: [{ decidedAt: "desc" }, { id: "desc" }], select: { assignmentId: true, assignmentVersion: true, evidenceFingerprint: true, decision: true, reason: true, decidedAt: true } }),
    db.attendancePeriod.findMany({ where: { centerId: { in: [...new Set(truc.map((t) => t.centerId))] }, periodKey: { in: thang }, status: "LOCKED" }, select: { centerId: true, periodKey: true } }),
    dungSaiTheoCoSo([...new Set(truc.map((t) => t.centerId))]),
  ]);
  // Tiết dạy: CÙNG đối soát P5a — một lượt cho mỗi cơ sở có tiết của những người trực này.
  const doiSoat = await Promise.all(tietPc.map((c) => docDoiSoatThucHien({ centerId: c.centerId, tu: p.tu, den: p.den, now: p.now })));
  const tietCua = new Map<string, TietTrongNgay[]>();
  for (const ds of doiSoat)
    for (const d of ds.dong) {
      if (!nguoi.includes(d.bc.userId)) continue;
      // Không phải tiết DẠY được trả (LEGACY, TRIAL, buổi huỷ) ⇒ không đếm, không chặn.
      if (d.ungVien.lop === "KHONG_AP_DUNG") continue;
      const quyet: TietTrongNgay["quyet"] = d.ungVien.lyDo.includes("THOI_LUONG_KHONG_CHUAN")
        ? "Q1_KHONG_CHUAN"
        : d.donVi?.hieuLuc === "CONFIRMED"
          ? "XAC_NHAN"
          : d.xacNhan?.decision === "REJECTED"
            ? "TU_CHOI"
            : "CHUA";
      const k = `${d.bc.userId}|${d.bc.workDate}`;
      if (!d.bc.requiredTo || d.ungVien.thoiLuongDayPhut == null) continue;
      // Giờ DẠY (không gồm 10' chuẩn bị): kết thúc − thời lượng dạy.
      const batDau = new Date(d.bc.requiredTo.getTime() - d.ungVien.thoiLuongDayPhut * 60_000);
      tietCua.set(k, [...(tietCua.get(k) ?? []), { assignmentId: d.bc.assignmentId, gioBatDau: hhmm(batDau), gioKetThuc: hhmm(d.bc.requiredTo), quyet }]);
    }
  const luotCua = new Map<string, typeof luot>();
  for (const l of luot) {
    const k = `${l.userId}|${ymd(l.workDate)}`;
    luotCua.set(k, [...(luotCua.get(k) ?? []), l]);
  }
  const khoa = new Set(kyKhoaRaw.map((k) => `${k.centerId}|${k.periodKey}`));
  return truc.map((t): DongTruc => {
    const ngay = ymd(t.workDate);
    const cs = chinhSachTaiNgay(chinhSach, ngay);
    const bamTrung = dungSai.get(t.centerId)?.bamTrungPhut ?? 2;
    const v: DauVaoTruc = {
      thamSo: cs?.thamSo ?? null,
      ngay,
      shiftCode: t.shiftCode,
      centerId: t.centerId,
      conSong: (SONG as readonly string[]).includes(t.status),
      daNhan: t.acceptances.some((a) => a.assignmentVersion === t.assignmentVersion && a.decision === "ACCEPTED"),
      tiet: tietCua.get(`${t.userId}|${ngay}`) ?? [],
      khoang: khoangCoMatTrongNgay(luotCua.get(`${t.userId}|${ngay}`) ?? [], bamTrung),
      now: p.now,
    };
    const danhGia = danhGiaTruc(v);
    const dauVan = dauVanTruc({ dutyId: t.id, phienBan: t.assignmentVersion, v, d: danhGia });
    const kyKhoa = khoa.has(`${t.centerId}|${ngay.slice(0, 7)}`);
    const w = donViRaw.find((x) => x.assignmentId === t.id);
    const xn = xacNhanRaw.find((x) => x.assignmentId === t.id && x.assignmentVersion === t.assignmentVersion && x.evidenceFingerprint === dauVan) ?? null;
    const ht = (SONG as readonly string[]).includes(t.status) ? { assignmentVersion: t.assignmentVersion, dauVan } : null;
    return {
      dutyId: t.id,
      userId: t.userId,
      centerId: t.centerId,
      ngay,
      shiftCode: t.shiftCode,
      status: t.status,
      phienBan: t.assignmentVersion,
      danhGia,
      dauVan,
      policyVersionId: cs?.id ?? null,
      kyKhoa,
      xacNhan: xn && { decision: xn.decision, reason: xn.reason, decidedAt: xn.decidedAt },
      donVi: w
        ? { id: w.id, quantity: w.quantity.toString(), rateSnapshot: w.rateSnapshot, status: w.status, hieuLuc: trangThaiHieuLuc({ status: w.status, assignmentVersion: w.assignmentVersion, evidenceFingerprint: w.evidenceFingerprint }, ht, kyKhoa) }
        : null,
    };
  });
}

const hhmm = (d: Date) => d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Ho_Chi_Minh" });

// ─── Xác nhận đơn vị trực ───────────────────────────────────────────────────────────────────

const LOP_CONG: Record<LopTruc, LopUngVien> = { TU_DONG: "TU_DONG", XEM_TAY: "XEM_TAY", CHAN: "CHAN", CHO: "CHUA_XONG", KHONG_AP_DUNG: "KHONG_AP_DUNG" };

/**
 * QLCS xác nhận đơn vị trả của MỘT ca trực. Đơn vị "0" (≥ 2 tiết) ⇒ ghi quyết định, KHÔNG sinh WorkUnit (không có gì để trả).
 * Cùng cổng `kiemXacNhan` với xác nhận dạy (tự xác nhận, kỳ khoá, phiên bản / dấu vân đã xem, hàng loạt, lý do).
 */
export async function xacNhanTruc(p: {
  dutyId: string;
  phienBanDaXem: number;
  dauVanDaXem: string;
  quyetDinh: QuyetDinhThucHien;
  lyDo: string | null;
  hangLoat: boolean;
  actor: NguoiThaoTac & { id: string };
  now: Date;
}): Promise<KetQua<{ daCo: boolean; workUnitId: string | null }>> {
  const t = await db.operationsDutyAssignment.findUnique({ where: { id: p.dutyId }, select: CHON_TRUC });
  if (!t) return { ok: false, loi: "Không tìm thấy dòng trực." };
  const ngay = ymd(t.workDate);
  const [dong] = await danhGiaDanhSach([t], { tu: ngay, den: ngay, now: p.now });
  const loi = kiemXacNhan({
    ungVien: { lop: LOP_CONG[dong.danhGia.lop], lyDo: dong.danhGia.lyDo },
    phienBanHienTai: t.assignmentVersion,
    dauVanHienTai: dong.dauVan,
    phienBanDaXem: p.phienBanDaXem,
    dauVanDaXem: p.dauVanDaXem,
    quyetDinh: p.quyetDinh,
    lyDo: p.lyDo,
    nguoiXacNhanId: p.actor.id,
    nguoiLamId: t.userId,
    kyKhoa: dong.kyKhoa,
    hangLoat: p.hangLoat,
  });
  if (loi) return { ok: false, loi };
  const dg = dong.danhGia;
  if (p.quyetDinh === "CONFIRMED" && (dg.donViTra == null || dg.donGiaCa == null || !dong.policyVersionId)) return { ok: false, loi: "Chưa tính được đơn vị trả cho ca này." };
  const snapshot = { lop: dg.lop, lyDo: dg.lyDo, khung: dg.khung, soTietTrongCa: dg.soTietTrongCa, tietTrongCa: dg.tietTrongCa, tietVuotCa: dg.tietVuotCa, donViTra: dg.donViTra, phutCoMatTrongCa: dg.phutCoMatTrongCa };
  try {
    return await db.$transaction(async (tx) => {
      const song = await tx.workUnit.findMany({ where: { assignmentId: t.id, workUnitType: "OPERATIONS_DUTY", status: { not: "VOIDED" } }, select: { id: true, status: true, assignmentVersion: true, evidenceFingerprint: true } });
      const trung = song.find((w) => w.status === "CONFIRMED" && w.assignmentVersion === t.assignmentVersion && w.evidenceFingerprint === dong.dauVan);
      if (p.quyetDinh === "CONFIRMED" && trung) return { ok: true as const, daCo: true, workUnitId: trung.id };
      const daQuyet0 = p.quyetDinh === "CONFIRMED" && dg.donViTra === "0" && dong.xacNhan?.decision === "CONFIRMED";
      if (daQuyet0) return { ok: true as const, daCo: true, workUnitId: null };

      const xn = await tx.workConfirmation.create({
        data: { assignmentId: t.id, assignmentVersion: t.assignmentVersion, evidenceFingerprint: dong.dauVan, decision: p.quyetDinh, reason: p.lyDo?.trim() || null, evidenceSnapshot: snapshot, decidedById: p.actor.id, decidedAt: p.now, centerId: t.centerId, orgUnitId: t.orgUnitId },
        select: { id: true },
      });
      await writeAudit({ actor: p.actor, module: MODULE, entityType: ENTITY, entityId: t.id, action: p.quyetDinh === "CONFIRMED" ? "PT_WORK_CONFIRMED" : p.quyetDinh === "REJECTED" ? "PT_WORK_REJECTED" : "PT_WORK_NEEDS_INFO", newValues: { workConfirmationId: xn.id, phienBan: t.assignmentVersion, dauVan: dong.dauVan, hangLoat: p.hangLoat, ...snapshot }, reason: p.lyDo ?? undefined, orgUnitId: t.orgUnitId, tx });
      if (p.quyetDinh === "NEEDS_INFO") return { ok: true as const, daCo: false, workUnitId: null };
      for (const w of song) {
        await tx.workUnit.update({ where: { id: w.id }, data: { status: "VOIDED", voidedAt: p.now, voidedById: p.actor.id, voidReason: p.quyetDinh === "REJECTED" ? "QLCS từ chối" : "Thay bằng xác nhận mới" } });
        await writeAudit({ actor: p.actor, module: MODULE, entityType: "WorkUnit", entityId: w.id, action: "PT_WORKUNIT_VOIDED", oldValues: { status: w.status }, newValues: { status: "VOIDED", workConfirmationId: xn.id }, orgUnitId: t.orgUnitId, tx });
      }
      if (p.quyetDinh === "REJECTED" || dg.donViTra === "0") return { ok: true as const, daCo: false, workUnitId: null };
      const wu = await tx.workUnit.create({
        data: {
          userId: t.userId,
          centerId: t.centerId,
          orgUnitId: t.orgUnitId,
          workDate: t.workDate,
          assignmentId: t.id,
          assignmentVersion: t.assignmentVersion,
          role: "OPERATIONS_SUPPORT",
          workUnitType: "OPERATIONS_DUTY",
          quantity: new Prisma.Decimal(dg.donViTra!),
          // Đơn vị trực KHÔNG quy phút chuẩn — phút có mặt thực là thước đo riêng (báo cáo), không đổi sang đơn vị.
          standardMinutes: 0,
          policyVersionId: dong.policyVersionId!,
          rankSnapshot: null,
          rateSnapshot: dg.donGiaCa!,
          evidenceFingerprint: dong.dauVan,
          evidenceStatus: dg.lop,
          confirmationId: xn.id,
          confirmedById: p.actor.id,
          confirmedAt: p.now,
        },
        select: { id: true },
      });
      await writeAudit({ actor: p.actor, module: MODULE, entityType: "WorkUnit", entityId: wu.id, action: "PT_WORKUNIT_CREATED", newValues: { dutyId: t.id, phienBan: t.assignmentVersion, loai: "OPERATIONS_DUTY", quantity: dg.donViTra, rateSnapshot: dg.donGiaCa, soTietTrongCa: dg.soTietTrongCa }, orgUnitId: t.orgUnitId, tx });
      return { ok: true as const, daCo: false, workUnitId: wu.id };
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002" && p.quyetDinh === "CONFIRMED") {
      const co = await db.workUnit.findFirst({ where: { assignmentId: t.id, assignmentVersion: t.assignmentVersion, evidenceFingerprint: dong.dauVan, status: "CONFIRMED" }, select: { id: true } });
      if (co) return { ok: true, daCo: true, workUnitId: co.id };
    }
    throw e;
  }
}

/** Ghi STALE cho đơn vị TRỰC đã lệch (tiết trong ca đổi quyết định, nhận lại…) — kỳ chưa khoá. Idempotent. Cùng nghĩa
 *  `danhDauDonViCu` của đơn vị dạy; hai hàm tách vì đơn vị trực không thuộc đối soát dạy. */
export async function danhDauTrucCu(p: { centerId: string; tu: string; den: string; now: Date; actor: NguoiThaoTac & { id: string } }): Promise<number> {
  const cu = (await docTrucCoSo(p)).filter((t) => t.donVi && t.donVi.status === "CONFIRMED" && t.donVi.hieuLuc === "STALE");
  if (!cu.length) return 0;
  return db.$transaction(async (tx) => {
    let n = 0;
    for (const t of cu) {
      const u = await tx.workUnit.updateMany({ where: { id: t.donVi!.id, status: "CONFIRMED" }, data: { status: "STALE", staleAt: p.now, staleReason: "BANG_CHUNG_DOI" } });
      if (u.count === 0) continue;
      n++;
      await writeAudit({ actor: p.actor, module: MODULE, entityType: "WorkUnit", entityId: t.donVi!.id, action: "PT_WORKUNIT_STALE", oldValues: { status: "CONFIRMED" }, newValues: { status: "STALE", dutyId: t.dutyId }, tx });
    }
    return n;
  });
}

/** Ca trực ĐANG CHỜ chính người đó nhận, ca chưa kết thúc — cho "Công việc của tôi". `userId` PHẢI lấy từ phiên ở nơi gọi. */
export async function docTrucChoNhan(p: { userId: string; now: Date }): Promise<{ dutyId: string; phienBan: number; ngay: string; shiftCode: string; tu: string; den: string }[]> {
  const homNay = new Date(`${new Date(p.now.getTime() + 7 * 3_600_000).toISOString().slice(0, 10)}T00:00:00Z`);
  const [ds, chinhSach] = await Promise.all([
    db.operationsDutyAssignment.findMany({ where: { userId: p.userId, status: "WAITING_ACCEPTANCE", workDate: { gte: homNay } }, orderBy: [{ workDate: "asc" }, { shiftCode: "asc" }], select: { id: true, assignmentVersion: true, workDate: true, shiftCode: true } }),
    docChinhSach(),
  ]);
  return ds.flatMap((d) => {
    const ngay = ymd(d.workDate);
    const cs = chinhSachTaiNgay(chinhSach, ngay);
    const ca = cs && cs.thamSo.loai === "SR_QD_238" ? cs.thamSo.ca.find((c) => c.ma === d.shiftCode) : null;
    if (!ca || p.now.getTime() >= new Date(`${ngay}T${ca.den}:00+07:00`).getTime()) return [];
    return [{ dutyId: d.id, phienBan: d.assignmentVersion, ngay, shiftCode: d.shiftCode, tu: ca.tu, den: ca.den }];
  });
}
