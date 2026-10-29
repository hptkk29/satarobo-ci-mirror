// lib/parttime/workunit-db.ts — P5a · ĐỌC đối soát thực hiện + GHI xác nhận thực hiện / đơn vị công việc.
//
// Đọc: `docDoiSoatThucHien` = bằng chứng P4 (`docBangChungCong`, CÙNG định nghĩa với Control Tower) → `xetUngVien` (MỘT hàm
// xếp loại) + xác nhận mới nhất + đơn vị đang sống + kỳ khoá. Số câu tra KHÔNG phụ thuộc số phân công.
// Ghi: `xacNhanThucHien` — nơi gọi (server action) đã kiểm quyền `hr_attendance:assign` ở cơ sở CỦA BUỔI + công tắc. Mọi cổng
// đứng TRƯỚC phép ghi đầu tiên; thử lại / bấm đúp an toàn nhờ chỉ mục từng phần `WorkUnit_live_assignment_key`.
//
// KHÔNG đổi trạng thái phân công khi xác nhận: `status` của phân công nằm trong dấu vân P4 — đổi nó là tự làm cũ chính đơn vị
// vừa sinh.
import { docKyLuatMoi } from "@/lib/phan-cong/ky-luat-db";
import "server-only";
import { Prisma, type WorkConfirmationDecision } from "@prisma/client";
import { db } from "@/lib/db";
import { writeAudit } from "@/lib/audit/audit-log";
import type { BangChungPhanCong } from "./bang-chung-cong";
import { docBangChungCong } from "./bang-chung-cong-db";
import { chinhSachTaiNgay, type BanChinhSach } from "./chinh-sach";
import { rutDeXuatCuaDonVi } from "./dieu-chinh-rut";
import { docGhiDeDonVi, khoaBuoiCua } from "./don-vi-tiet-db";
import { ghiDeChoBuoi, type GhiDeDonVi, type KhoaBuoi } from "./don-vi-tiet";
import { docChinhSach, type NguoiThaoTac } from "./phan-cong-db";
import { rankTaiNgay } from "./rank";
import { docTuanThu } from "./tuan-thu-buoi-db";
import type { TuanThuBuoi } from "./tuan-thu-buoi";
import {
  anhChupDonVi,
  kiemXacNhan,
  loaiDonViCuaVai,
  lyDoCu,
  trangThaiHieuLuc,
  xetUngVien,
  type LyDoCu,
  type QuyetDinhThucHien,
  type UngVienWorkUnit,
} from "./workunit";

const MODULE = "hr_attendance";
export const HANH_DONG_THUC_HIEN = {
  XAC_NHAN: "PT_WORK_CONFIRMED",
  TU_CHOI: "PT_WORK_REJECTED",
  CAN_THEM: "PT_WORK_NEEDS_INFO",
  TAO_DON_VI: "PT_WORKUNIT_CREATED",
  HUY_DON_VI: "PT_WORKUNIT_VOIDED",
  DON_VI_CU: "PT_WORKUNIT_STALE",
} as const;

const ymd = (d: Date) => d.toISOString().slice(0, 10);

export type DonViSong = {
  id: string;
  userId: string;
  assignmentId: string | null;
  assignmentVersion: number | null;
  workUnitType: string;
  /** Trạng thái lưu trong DB. */
  status: "CONFIRMED" | "STALE" | "VOIDED";
  /** Trạng thái khi đọc (lệch mà chưa đánh dấu cũng là STALE). */
  hieuLuc: "CONFIRMED" | "STALE" | "VOIDED";
  lyDoCu: LyDoCu | null;
  quantity: string;
  standardMinutes: number;
  rateSnapshot: number;
  rankSnapshot: number | null;
  evidenceFingerprint: string;
  confirmedAt: Date;
  workDate: string;
};

export type DongDoiSoat = {
  bc: BangChungPhanCong;
  ungVien: UngVienWorkUnit;
  policyVersionId: string | null;
  kyKhoa: boolean;
  /** Tuân thủ buổi dạy (điểm danh + nhận xét học viên) — chỉ ĐỌC; không vào dấu vân (WorkUnit là sự thật dạy, không lỗi thời vì nhận xét). */
  tuanThu: TuanThuBuoi | null;
  /** Xác nhận mới nhất cho ĐÚNG phiên bản + dấu vân hiện tại (null = chưa ai quyết trên dữ liệu này). */
  xacNhan: { decision: WorkConfirmationDecision; reason: string | null; decidedAt: Date; decidedById: string } | null;
  donVi: DonViSong | null;
};

export type KetQuaDoiSoat = {
  dong: DongDoiSoat[];
  /** Đơn vị còn sống mà phân công của nó không còn trong tập xét (bị thay / huỷ) — luôn CŨ (trừ kỳ khoá). */
  donViMoCoi: DonViSong[];
};

const CHON_DON_VI = {
  id: true,
  userId: true,
  assignmentId: true,
  assignmentVersion: true,
  workUnitType: true,
  status: true,
  quantity: true,
  standardMinutes: true,
  rateSnapshot: true,
  rankSnapshot: true,
  evidenceFingerprint: true,
  confirmedAt: true,
  workDate: true,
  staleReason: true,
} satisfies Prisma.WorkUnitSelect;

/** MỘT cơ sở × khoảng ngày. Nơi gọi đã kiểm quyền xem cơ sở. */
export async function docDoiSoatThucHien(p: { centerId: string; tu: string; den: string; now: Date }): Promise<KetQuaDoiSoat> {
  const thang = [...new Set([p.tu.slice(0, 7), p.den.slice(0, 7)])];
  const [bc, chinhSach, donViRaw, kyKhoaRaw] = await Promise.all([
    docBangChungCong(p),
    docChinhSach(),
    db.workUnit.findMany({
      // CHỈ đơn vị DẠY: đơn vị trực (OPERATIONS_DUTY) có assignmentId là dòng trực, không phải phân công buổi — đọc chung ở
      // đây thì nó thành "mồ côi" và bị coi là CŨ / bị đánh dấu STALE oan (`[P5-RDB-05]`).
      where: { centerId: p.centerId, workDate: { gte: new Date(`${p.tu}T00:00:00Z`), lte: new Date(`${p.den}T00:00:00Z`) }, status: { not: "VOIDED" }, workUnitType: { in: ["MAIN_TEACHING", "ASSISTANT_TEACHING"] } },
      select: CHON_DON_VI,
    }),
    db.attendancePeriod.findMany({ where: { centerId: p.centerId, periodKey: { in: thang }, status: "LOCKED" }, select: { periodKey: true } }),
  ]);
  const pcs = bc.phanCong.filter((r) => loaiDonViCuaVai(r.role));
  const ids = pcs.map((r) => r.assignmentId);
  const bu = pcs.filter((r) => r.sourceType === "MAKEUP_CASE").map((r) => r.sourceId);
  const [buVang, xacNhanRaw, ghiDe, tuanThu] = await Promise.all([
    bu.length ? db.makeupCase.findMany({ where: { id: { in: bu }, status: "NO_SHOW" }, select: { id: true } }) : [],
    ids.length
      ? db.workConfirmation.findMany({
          where: { assignmentId: { in: ids } },
          orderBy: [{ decidedAt: "desc" }, { id: "desc" }],
          select: { assignmentId: true, assignmentVersion: true, evidenceFingerprint: true, decision: true, reason: true, decidedAt: true, decidedById: true },
        })
      : [],
    // Q1 — ghi đè số tiết đã duyệt (bảng chính sách nhỏ; prod phát hành RỖNG ⇒ không tra thêm định danh buổi).
    docGhiDeDonVi(),
    docTuanThu(pcs, p.now),
  ]);
  const khoa = ghiDe.length ? await khoaBuoiCua(pcs) : new Map<string, KhoaBuoi>();
  return ghepDoiSoat({ pcs, chinhSach, donViRaw, kyKhoa: new Set(kyKhoaRaw.map((k) => k.periodKey)), buVang: new Set(buVang.map((b) => b.id)), xacNhanRaw, ghiDe, khoa, tuanThu, now: p.now });
}

function ghepDoiSoat(p: {
  pcs: BangChungPhanCong[];
  chinhSach: BanChinhSach[];
  donViRaw: Prisma.WorkUnitGetPayload<{ select: typeof CHON_DON_VI }>[];
  kyKhoa: Set<string>;
  buVang: Set<string>;
  xacNhanRaw: { assignmentId: string; assignmentVersion: number; evidenceFingerprint: string; decision: WorkConfirmationDecision; reason: string | null; decidedAt: Date; decidedById: string }[];
  ghiDe: readonly GhiDeDonVi[];
  /** Định danh buổi (lớp / khoá / loại buổi) — chỉ dựng khi có ghi đè. */
  khoa: ReadonlyMap<string, KhoaBuoi>;
  tuanThu: ReadonlyMap<string, TuanThuBuoi>;
  now: Date;
}): KetQuaDoiSoat {
  const hienTai = new Map(p.pcs.map((r) => [r.assignmentId, { assignmentVersion: r.assignmentVersion, dauVan: r.dauVan }]));
  const docDonVi = (w: (typeof p.donViRaw)[number]): DonViSong => {
    const ngay = ymd(w.workDate);
    const khoa = p.kyKhoa.has(ngay.slice(0, 7));
    const ht = w.assignmentId ? (hienTai.get(w.assignmentId) ?? null) : null;
    const dv = { status: w.status, assignmentVersion: w.assignmentVersion, evidenceFingerprint: w.evidenceFingerprint };
    const { staleReason: _bo, ...con } = w;
    return {
      ...con,
      quantity: w.quantity.toString(),
      workDate: ngay,
      hieuLuc: trangThaiHieuLuc(dv, ht, khoa),
      lyDoCu: lyDoCu(dv, ht, khoa) ?? (w.status === "STALE" ? ((w.staleReason as LyDoCu | null) ?? null) : null),
    };
  };
  const donViTheoPc = new Map<string, DonViSong>();
  const moCoi: DonViSong[] = [];
  for (const w of p.donViRaw) {
    const d = docDonVi(w);
    if (w.assignmentId && hienTai.has(w.assignmentId)) donViTheoPc.set(w.assignmentId, d);
    else moCoi.push(d);
  }
  const dong = p.pcs.map((bc): DongDoiSoat => {
    const cs = chinhSachTaiNgay(p.chinhSach, bc.workDate);
    const k = p.khoa.get(`${bc.sourceType}:${bc.sourceId}`) ?? { sessionId: null, classId: null, courseId: null, sessionType: null };
    const ungVien = xetUngVien(bc, {
      thamSo: cs?.thamSo ?? null,
      hocBuVangMat: bc.sourceType === "MAKEUP_CASE" && p.buVang.has(bc.sourceId),
      now: p.now,
      ghiDe: ghiDeChoBuoi(p.ghiDe, k, bc.workDate, cs?.id ?? null),
      tuanThu: p.tuanThu.get(bc.assignmentId) ?? null,
    });
    const xn = p.xacNhanRaw.find((x) => x.assignmentId === bc.assignmentId && x.assignmentVersion === bc.assignmentVersion && x.evidenceFingerprint === bc.dauVan) ?? null;
    return {
      bc,
      ungVien,
      policyVersionId: cs?.id ?? null,
      kyKhoa: p.kyKhoa.has(bc.workDate.slice(0, 7)),
      tuanThu: p.tuanThu.get(bc.assignmentId) ?? null,
      xacNhan: xn && { decision: xn.decision, reason: xn.reason, decidedAt: xn.decidedAt, decidedById: xn.decidedById },
      donVi: donViTheoPc.get(bc.assignmentId) ?? null,
    };
  });
  return { dong, donViMoCoi: moCoi };
}

// ─── Ghi ────────────────────────────────────────────────────────────────────────────────────

export type KetQuaXacNhan = { ok: true; daCo: boolean; workUnitId: string | null } | { ok: false; loi: string };

export type PhanCongGoc = { centerId: string; orgUnitId: string | null; ngay: Date; userId: string };
type AnhDonVi = ReturnType<typeof anhChupDonVi>;
export type SnapshotThucHien = Record<string, unknown>;

/**
 * Ảnh chụp đơn vị (đơn giá, rank, số tiết Q1) cho quyết định CONFIRMED của MỘT dòng đối soát. CHỈ ĐỌC — gọi NGOÀI giao dịch. Dùng
 * chung: QLCS xác nhận tay (kỳ cũ) và ghi cứng lúc chốt kỳ (kỳ luật mới, GĐ6) — "ai quyết" khác, "bao nhiêu" KHÔNG khác (không đổi
 * công thức lương).
 */
export async function anhChupChoDong(dong: DongDoiSoat, pc: PhanCongGoc): Promise<{ ok: true; anh: AnhDonVi } | { ok: false; loi: string }> {
  const ngay = ymd(pc.ngay);
  const chinhSach = await docChinhSach();
  const cs = chinhSachTaiNgay(chinhSach, ngay);
  if (!cs || cs.thamSo.loai !== "SR_QD_238" || !dong.ungVien.loai) return { ok: false, loi: "Ngày này không thuộc SR.QD.238." };
  let rank: number | null = null;
  if (dong.ungVien.loai === "MAIN_TEACHING") {
    const lichSu = await db.teacherRankHistory.findMany({ where: { userId: pc.userId, effectiveFrom: { lte: pc.ngay } }, select: { rank: true, effectiveFrom: true } });
    rank = rankTaiNgay(lichSu.map((r) => ({ rank: r.rank, hieuLucTu: ymd(r.effectiveFrom) })), ngay, cs.thamSo.rankMacDinh).rank;
  }
  // Số tiết = Q1 (buổi chuẩn "1" · ghi đè đã duyệt). Lệch chuẩn không ghi đè đã bị chặn ở `kiemXacNhan` (CHAN) — chặn lần nữa ở đây.
  const soTiet = dong.ungVien.donViTiet?.donVi;
  if (!soTiet) return { ok: false, loi: "Buổi chưa có số tiết theo chính sách (Q1 — cần quyết định)." };
  return { ok: true, anh: anhChupDonVi(dong.ungVien.loai, cs.thamSo, rank, soTiet) };
}

/** Ảnh chụp BẰNG CHỨNG lưu vào WorkConfirmation + audit — một hàm cho cả hai cửa ghi. */
export function snapshotThucHien(dong: DongDoiSoat): SnapshotThucHien {
  const bc = dong.bc;
  return {
    trangThai: bc.trangThai,
    lop: dong.ungVien.lop,
    lyDo: dong.ungVien.lyDo,
    treVaoPhut: bc.treVaoPhut,
    raSomPhut: bc.raSomPhut,
    checkInAt: bc.checkInAt?.toISOString() ?? null,
    checkOutAt: bc.checkOutAt?.toISOString() ?? null,
    attendanceInId: bc.dongDoi.attendanceInId,
    attendanceOutId: bc.dongDoi.attendanceOutId,
    nguoiDayId: bc.dongDoi.nguoiDayId,
    chinhSach: bc.dongDoi.chinhSach,
    thoiLuongDayPhut: dong.ungVien.thoiLuongDayPhut,
    // Tuân thủ tại lúc quyết (chỉ ghi lại để tra cứu — không đổi số lượng / đơn giá của đơn vị).
    tuanThu: dong.tuanThu && {
      tong: dong.tuanThu.overallStatus,
      diemDanh: `${dong.tuanThu.studentAttendanceRecorded}/${dong.tuanThu.studentAttendanceExpected}`,
      nhanXet: `${dong.tuanThu.studentCommentsCompleted}/${dong.tuanThu.studentCommentsExpected ?? "?"}`,
      trangThaiNhanXet: dong.tuanThu.studentCommentStatus,
      // Q15 (chủ dự án chốt 19/10/2026): nộp trễ là SỰ THẬT — giữ hạn / lúc hoàn tất / số phút trễ, không phải mức phạt.
      hanNhanXet: dong.tuanThu.commentDeadline?.toISOString() ?? null,
      nhanXetXongLuc: dong.tuanThu.commentsCompletedAt?.toISOString() ?? null,
      nhanXetTrePhut: dong.tuanThu.commentsLateByMinutes,
    },
  };
}

/**
 * PHÉP GHI của một quyết định thực hiện, TRONG giao dịch của nơi gọi (mọi cổng đã đứng trước). CONFIRMED trên đúng dữ liệu đã có đơn vị
 * ⇒ không ghi gì (idempotent — chốt lại kỳ sau khi mở không nhân đôi). Còn lại: WorkConfirmation (bất biến) → VOID đơn vị cũ (rút đề
 * xuất trừ đang treo) → WorkUnit mới. Hai cửa gọi: `xacNhanThucHien` (QLCS, kỳ cũ) và ghi cứng lúc chốt kỳ (GĐ6, người chốt).
 */
export async function ghiQuyetDinhThucHienTrongTx(
  tx: Prisma.TransactionClient,
  p: {
    assignmentId: string;
    pc: PhanCongGoc;
    dong: DongDoiSoat;
    anh: AnhDonVi | null;
    snapshot: SnapshotThucHien;
    quyetDinh: QuyetDinhThucHien;
    lyDo: string | null;
    hangLoat: boolean;
    actor: NguoiThaoTac & { id: string };
    now: Date;
  },
): Promise<{ daCo: boolean; workUnitId: string | null }> {
  const { pc, dong, anh, snapshot } = p;
  const bc = dong.bc;
  const song = await tx.workUnit.findMany({ where: { assignmentId: p.assignmentId, status: { not: "VOIDED" } }, select: { id: true, status: true, assignmentVersion: true, evidenceFingerprint: true } });
  const trung = song.find((w) => w.status === "CONFIRMED" && w.assignmentVersion === bc.assignmentVersion && w.evidenceFingerprint === bc.dauVan);
  // Bấm lại trên đúng dữ liệu đã xác nhận ⇒ không ghi gì (cổng TRƯỚC phép ghi đầu tiên).
  if (p.quyetDinh === "CONFIRMED" && trung) return { daCo: true, workUnitId: trung.id };

  const xn = await tx.workConfirmation.create({
    data: {
      assignmentId: p.assignmentId,
      assignmentVersion: bc.assignmentVersion,
      evidenceFingerprint: bc.dauVan,
      decision: p.quyetDinh,
      reason: p.lyDo?.trim() || null,
      evidenceSnapshot: snapshot as Prisma.InputJsonValue,
      decidedById: p.actor.id,
      decidedAt: p.now,
      centerId: pc.centerId,
      orgUnitId: pc.orgUnitId,
    },
    select: { id: true },
  });
  await writeAudit({
    actor: p.actor,
    module: MODULE,
    entityType: "SessionStaffAssignment",
    entityId: p.assignmentId,
    action: p.quyetDinh === "CONFIRMED" ? HANH_DONG_THUC_HIEN.XAC_NHAN : p.quyetDinh === "REJECTED" ? HANH_DONG_THUC_HIEN.TU_CHOI : HANH_DONG_THUC_HIEN.CAN_THEM,
    newValues: { workConfirmationId: xn.id, phienBan: bc.assignmentVersion, dauVan: bc.dauVan, hangLoat: p.hangLoat, ...snapshot },
    reason: p.lyDo ?? undefined,
    orgUnitId: pc.orgUnitId,
    tx,
  });
  if (p.quyetDinh === "NEEDS_INFO") return { daCo: false, workUnitId: null };

  // Khoản trừ ĐANG ĐỀ XUẤT của đơn vị sắp VOID: rút cùng giao dịch (đồng bộ đề xuất sẽ dựng lại cho đơn vị mới nếu bằng chứng
  // vẫn ủng hộ). Khoản ĐÃ XÁC NHẬN giữ nguyên — gắn theo phân công, không theo đơn vị.
  await rutDeXuatCuaDonVi(tx, { workUnitIds: song.map((w) => w.id), lyDo: "Rút: đơn vị công việc bị thay / từ chối", actor: p.actor, now: p.now });
  for (const w of song) {
    await tx.workUnit.update({ where: { id: w.id }, data: { status: "VOIDED", voidedAt: p.now, voidedById: p.actor.id, voidReason: p.quyetDinh === "REJECTED" ? "QLCS từ chối" : "Thay bằng xác nhận mới" } });
    await writeAudit({ actor: p.actor, module: MODULE, entityType: "WorkUnit", entityId: w.id, action: HANH_DONG_THUC_HIEN.HUY_DON_VI, oldValues: { status: w.status }, newValues: { status: "VOIDED", workConfirmationId: xn.id }, orgUnitId: pc.orgUnitId, tx });
  }
  if (p.quyetDinh === "REJECTED" || !anh) return { daCo: false, workUnitId: null };

  const wu = await tx.workUnit.create({
    data: {
      userId: bc.userId,
      centerId: pc.centerId,
      orgUnitId: pc.orgUnitId,
      workDate: pc.ngay,
      assignmentId: p.assignmentId,
      assignmentVersion: bc.assignmentVersion,
      sourceType: bc.sourceType,
      sourceId: bc.sourceId,
      role: bc.role,
      activityType: bc.activity,
      assignmentType: (await tx.sessionStaffAssignment.findUniqueOrThrow({ where: { id: p.assignmentId }, select: { assignmentType: true } })).assignmentType,
      workUnitType: anh.loai,
      quantity: new Prisma.Decimal(anh.quantity),
      standardMinutes: anh.standardMinutes,
      policyVersionId: dong.policyVersionId!,
      rankSnapshot: anh.rankSnapshot,
      rateSnapshot: anh.rateSnapshot,
      evidenceFingerprint: bc.dauVan,
      evidenceStatus: bc.trangThai,
      confirmationId: xn.id,
      confirmedById: p.actor.id,
      confirmedAt: p.now,
    },
    select: { id: true },
  });
  await writeAudit({
    actor: p.actor,
    module: MODULE,
    entityType: "WorkUnit",
    entityId: wu.id,
    action: HANH_DONG_THUC_HIEN.TAO_DON_VI,
    newValues: { assignmentId: p.assignmentId, phienBan: bc.assignmentVersion, loai: anh.loai, quantity: anh.quantity, standardMinutes: anh.standardMinutes, rateSnapshot: anh.rateSnapshot, rankSnapshot: anh.rankSnapshot, policyVersionId: dong.policyVersionId },
    orgUnitId: pc.orgUnitId,
    tx,
  });
  return { daCo: false, workUnitId: wu.id };
}

/**
 * QLCS quyết "đã thực hiện" cho MỘT phân công. Xác nhận ⇒ một WorkConfirmation (bất biến) + một WorkUnit (ảnh chụp đơn giá,
 * rank, chính sách, dấu vân); đơn vị cũ còn sống của phân công này bị VOID (không xoá). Từ chối ⇒ VOID đơn vị đang sống.
 * Kỳ LUẬT MỚI (≥ 2026-11) bị `kiemXacNhan` từ chối: công tính khi đọc, ghi cứng lúc chốt kỳ (GĐ6, chốt 10).
 */
export async function xacNhanThucHien(p: {
  assignmentId: string;
  phienBanDaXem: number;
  dauVanDaXem: string;
  quyetDinh: QuyetDinhThucHien;
  lyDo: string | null;
  hangLoat: boolean;
  actor: NguoiThaoTac & { id: string };
  now: Date;
}): Promise<KetQuaXacNhan> {
  const pc = await db.sessionStaffAssignment.findUnique({ where: { id: p.assignmentId }, select: { centerId: true, orgUnitId: true, ngay: true, userId: true } });
  if (!pc) return { ok: false, loi: "Không tìm thấy phân công." };
  const ngay = ymd(pc.ngay);
  const ds = await docDoiSoatThucHien({ centerId: pc.centerId, tu: ngay, den: ngay, now: p.now });
  const dong = ds.dong.find((d) => d.bc.assignmentId === p.assignmentId);
  if (!dong) return { ok: false, loi: "Phân công này không còn trong danh sách đối soát (đã huỷ / bị thay)." };
  const loiCong = kiemXacNhan({
    ungVien: dong.ungVien,
    phienBanHienTai: dong.bc.assignmentVersion,
    dauVanHienTai: dong.bc.dauVan,
    phienBanDaXem: p.phienBanDaXem,
    dauVanDaXem: p.dauVanDaXem,
    quyetDinh: p.quyetDinh,
    lyDo: p.lyDo,
    nguoiXacNhanId: p.actor.id,
    nguoiLamId: pc.userId,
    kyKhoa: dong.kyKhoa,
    hangLoat: p.hangLoat,
    periodKey: ngay.slice(0, 7),
    tuKyLuatMoi: await docKyLuatMoi(),
  });
  if (loiCong) return { ok: false, loi: loiCong };

  // Ảnh chụp tính NGOÀI giao dịch (chỉ đọc) — đầu vào đã ghim bằng phiên bản + dấu vân vừa kiểm.
  let anh: AnhDonVi | null = null;
  if (p.quyetDinh === "CONFIRMED") {
    const a = await anhChupChoDong(dong, pc);
    if (!a.ok) return a;
    anh = a.anh;
  }
  const bc = dong.bc;
  const snapshot = snapshotThucHien(dong);
  try {
    return await db.$transaction(async (tx) => ({
      ok: true as const,
      ...(await ghiQuyetDinhThucHienTrongTx(tx, { assignmentId: p.assignmentId, pc, dong, anh, snapshot, quyetDinh: p.quyetDinh, lyDo: p.lyDo, hangLoat: p.hangLoat, actor: p.actor, now: p.now })),
    }));
  } catch (e) {
    // Hai lượt cùng lúc: lượt thua đụng `WorkUnit_live_assignment_key` ⇒ giao dịch của nó lùi sạch; trả đơn vị lượt thắng đã tạo.
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002" && p.quyetDinh === "CONFIRMED") {
      const co = await db.workUnit.findFirst({ where: { assignmentId: p.assignmentId, assignmentVersion: bc.assignmentVersion, evidenceFingerprint: bc.dauVan, status: "CONFIRMED" }, select: { id: true } });
      if (co) return { ok: true, daCo: true, workUnitId: co.id };
    }
    throw e;
  }
}

/** Ghi trạng thái STALE cho đơn vị đã lệch (kỳ chưa khoá). Trả số dòng đánh dấu. Idempotent. */
export async function danhDauDonViCu(p: { centerId: string; tu: string; den: string; now: Date; actor: NguoiThaoTac & { id: string } }): Promise<number> {
  const ds = await docDoiSoatThucHien(p);
  const cu = [...ds.dong.flatMap((d) => (d.donVi ? [d.donVi] : [])), ...ds.donViMoCoi].filter((d) => d.status === "CONFIRMED" && d.lyDoCu);
  if (!cu.length) return 0;
  return db.$transaction(async (tx) => {
    let n = 0;
    for (const d of cu) {
      const r = await tx.workUnit.updateMany({ where: { id: d.id, status: "CONFIRMED" }, data: { status: "STALE", staleAt: p.now, staleReason: d.lyDoCu } });
      if (r.count === 0) continue;
      n++;
      await writeAudit({ actor: p.actor, module: MODULE, entityType: "WorkUnit", entityId: d.id, action: HANH_DONG_THUC_HIEN.DON_VI_CU, oldValues: { status: "CONFIRMED" }, newValues: { status: "STALE", lyDo: d.lyDoCu }, tx });
      await rutDeXuatCuaDonVi(tx, { workUnitIds: [d.id], lyDo: "Rút: đơn vị công việc thành cũ", actor: p.actor, now: p.now });
    }
    return n;
  });
}
