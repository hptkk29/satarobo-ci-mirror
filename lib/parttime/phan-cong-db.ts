// lib/parttime/phan-cong-db.ts — CỬA GHI DUY NHẤT của phân công người vào buổi + xác nhận nhận lớp (SR.QD.238 · P2).
//
// Mọi đường (màn QLCS, đơn dạy thay, đơn nghỉ, tạo buổi, xoá buổi) gọi các hàm ở đây — không `create`/`update`
// SessionStaffAssignment ở nơi khác. Luật thuần ở `phan-cong.ts`; tham số chính sách ở `chinh-sach.ts`.
//
// ── Ba điều đã chốt (docs/cham-cong/parttime/SR-QD-238-AUDIT.md §8) ─────────────────────────────────
//  1. Phân công KHÔNG phải công. Không hàm nào ở đây sinh WorkUnit hay tiền.
//  2. Sổ "ai đã đứng lớp" vẫn là actualTeacherId/substituteTeacherId (luật 11/10). Phân công chỉ THÊM: TA theo buổi,
//     xác nhận nhận lớp, dấu vết nguồn. Lệch nhau lúc chốt buổi ⇒ ngoại lệ (P5), không bao giờ là công thứ hai.
//  3. Xác nhận nhận lớp là bản ghi BẤT BIẾN (trigger DB); đổi đáng kể ⇒ assignmentVersion + 1 ⇒ xác nhận cũ tự hết
//     hiệu lực (không cột "đã vô hiệu" nào để quên cập nhật).
//
// Từ chối = `throw` hoặc trả `{ ok:false }` TRƯỚC phép ghi đầu tiên (CLAUDE.md "Luật rollback").
import type { Prisma, StaffAssignmentStatus, StaffAssignmentType, WorkRole, WorkSourceType } from "@prisma/client";
import { db } from "@/lib/db";
import { writeAudit } from "@/lib/audit/audit-log";
import { getSetting } from "@/lib/settings/service";
import { sessionTimeRange } from "@/lib/classes/slots";
import { ENROLLMENT_ACTIVE_STATUS_LIST } from "@/lib/enrollment-status";
import { vnYmd } from "@/lib/time/vn";
import { loaiHoatDong, type BuoiVanHanh } from "./buoi";
import { chinhSachTaiNgay, docThamSo, type BanChinhSach, type ThamSoSrQd238 } from "./chinh-sach";
import {
  chuyenTrangThai,
  keHoachDongBo,
  macDinhCuaBuoi,
  SONG_CHUA_CHOT,
  type BuocDongBo,
  type TinhTrangBuoi,
  laTaBatBuoc,
  yeuCauTroGiangThuan,
  type YeuCauTroGiang,
  doiDangKe,
  TRANG_THAI_SONG,
  trangThaiNhanLuc,
  xacNhanConHieuLuc,
  type NghiaVu,
  type TrangThaiNhanLuc,
} from "./phan-cong";

type Tx = Prisma.TransactionClient;
export type Nguon = { sourceType: WorkSourceType; sourceId: string };
export type NguoiThaoTac = { id: string | null; name: string };
/** Thông báo trả về cho nơi gọi gửi SAU commit (notifyStaff không nhận tx). */
export type ThongBaoPhanCong = { userId: string; title: string; body: string; href: string; dedupeKey: string };

const MODULE = "hr_attendance";
const ENTITY = "SessionStaffAssignment";
const HREF_GV = "/teacher/phan-cong";

/** Hành động audit — một bộ tên, dùng chung. */
export const HANH_DONG = {
  TAO: "PT_ASSIGNMENT_CREATED",
  DOI: "PT_ASSIGNMENT_CHANGED",
  HUY: "PT_ASSIGNMENT_CANCELLED",
  YEU_CAU_XAC_NHAN: "PT_ACCEPTANCE_REQUESTED",
  NHAN: "PT_ASSIGNMENT_ACCEPTED",
  TU_CHOI: "PT_ASSIGNMENT_DECLINED",
  VO_HIEU: "PT_ACCEPTANCE_INVALIDATED",
  THAY: "PT_ASSIGNMENT_REPLACED",
  YEU_CAU_TA: "PT_TA_REQUIREMENT_SET",
  NHAC: "PT_ACCEPTANCE_REMINDED",
} as const;

// ─── Cổng bật / hiệu lực ──────────────────────────────────────────────────────────────────────

/** Công tắc tích hợp TỰ ĐỘNG (đơn từ, tạo buổi). Mặc định TẮT ⇒ merge không đổi hành vi. */
export async function phanCongBat(): Promise<boolean> {
  return getSetting("shift.phanCongNhanLopBat");
}

export async function docChinhSach(tx: Tx | typeof db = db): Promise<BanChinhSach[]> {
  const rows = await tx.compensationPolicyVersion.findMany({ orderBy: { effectiveFrom: "asc" } });
  return rows.map((r) => ({
    id: r.id,
    code: r.code,
    hieuLucTu: r.effectiveFrom.toISOString().slice(0, 10),
    hieuLucDen: r.effectiveTo ? r.effectiveTo.toISOString().slice(0, 10) : null,
    thamSo: docThamSo(r.paramsJson),
  }));
}

/** Tham số SR.QD.238 nếu ngày thuộc chính sách đó; null nếu ngày thuộc LEGACY (không áp phân công mới). */
export async function thamSoApDung(tx: Tx, ngay: string): Promise<ThamSoSrQd238 | null> {
  const b = chinhSachTaiNgay(await docChinhSach(tx), ngay);
  return b && b.thamSo.loai === "SR_QD_238" ? b.thamSo : null;
}

// ─── Đọc buổi (hàm chiếu ba nguồn) ────────────────────────────────────────────────────────────

export type BuoiDayDu = BuoiVanHanh & {
  orgUnitId: string | null;
  classId: string | null;
  tenLop: string | null;
  tenKhoa: string | null;
  /** GV đứng chính MẶC ĐỊNH của buổi. Buổi lớp: người dạy thay của buổi nếu có, không thì GV của lớp (GAP-04). */
  macDinhMainId: string | null;
  macDinhMainKieu: "SYSTEM" | "SUBSTITUTE";
  macDinhTaId: string | null;
  /** `ClassSession.substituteTeacherId` (null với học bù / trial). */
  nguoiDayThay: string | null;
  /** MO / DA_CHOT (đóng băng) / DA_DONG (huỷ · lớp đã xoá · lớp trial đã huỷ) — xem `keHoachDongBo`. */
  tinhTrang: TinhTrangBuoi;
  lyDoDong: string | null;
};


/**
 * Center → OrgUnit, tra QUA `tx` (cùng luật `orgUnitIdForCenter` của `lib/org/org-service.ts`). Bản kia luôn tra bằng
 * `db` trần, không cache — gọi nó trong giao dịch đang giữ khoá tư vấn là xin thêm một kết nối ngoài giao dịch, và N lượt
 * đồng bộ cùng buổi giữ hết pool chờ khoá ⇒ treo cả N (đo ở `[PT3A-12]`).
 */
async function donViCuaCoSo(tx: Tx, centerId: string): Promise<string | null> {
  const ou = await tx.orgUnit.findFirst({ where: { centerId, deletedAt: null }, select: { id: true } });
  return ou?.id ?? null;
}

export async function docBuoi(tx: Tx, n: Nguon): Promise<BuoiDayDu | null> {
  if (n.sourceType === "CLASS_SESSION") {
    const s = await tx.classSession.findUnique({
      where: { id: n.sourceId },
      select: {
        id: true,
        date: true,
        status: true,
        centerId: true,
        substituteTeacherId: true,
        sessionCategory: { select: { code: true } },
        class: {
          select: {
            id: true,
            name: true,
            status: true,
            deletedAt: true,
            centerId: true,
            teacherId: true,
            assistantId: true,
            startTime: true,
            endTime: true,
            course: { select: { name: true } },
          },
        },
      },
    });
    if (!s) return null;
    const centerId = s.centerId ?? s.class.centerId;
    if (!centerId) return null;
    const gio = sessionTimeRange(s.date, s.class.startTime, s.class.endTime);
    return {
      sourceType: n.sourceType,
      sourceId: s.id,
      centerId,
      orgUnitId: await donViCuaCoSo(tx, centerId),
      ngay: vnYmd(s.date),
      gioBatDau: gio.start,
      gioKetThuc: gio.end ?? gio.start,
      activity: loaiHoatDong(n.sourceType, s.sessionCategory?.code),
      trangThai: s.status,
      classId: s.class.id,
      tenLop: s.class.name,
      tenKhoa: s.class.course?.name ?? null,
      ...macDinhCuaBuoi({ sourceType: "CLASS_SESSION", trangThai: s.status, substituteTeacherId: s.substituteTeacherId, lop: s.class }),
    };
  }
  if (n.sourceType === "MAKEUP_CASE") {
    const c = await tx.makeupCase.findUnique({
      where: { id: n.sourceId },
      select: { id: true, date: true, startTime: true, endTime: true, status: true, centerId: true, teacherId: true, sessionCategoryId: true, courseId: true },
    });
    if (!c) return null;
    const [pl, khoa] = await Promise.all([
      c.sessionCategoryId ? tx.sessionCategory.findUnique({ where: { id: c.sessionCategoryId }, select: { code: true } }) : null,
      tx.course.findUnique({ where: { id: c.courseId }, select: { name: true } }),
    ]);
    return {
      sourceType: n.sourceType,
      sourceId: c.id,
      centerId: c.centerId,
      orgUnitId: await donViCuaCoSo(tx, c.centerId),
      ngay: c.date.toISOString().slice(0, 10),
      gioBatDau: c.startTime,
      gioKetThuc: c.endTime,
      activity: loaiHoatDong(n.sourceType, pl?.code),
      trangThai: c.status,
      classId: null,
      tenLop: null,
      tenKhoa: khoa?.name ?? null,
      ...macDinhCuaBuoi({ sourceType: "MAKEUP_CASE", trangThai: c.status, teacherId: c.teacherId }),
    };
  }
  const t = await tx.trialClassSession.findUnique({
    where: { id: n.sourceId },
    select: { id: true, date: true, startTime: true, endTime: true, status: true, teacherId: true, trialClass: { select: { centerId: true, teacherId: true, assistantId: true, status: true } } },
  });
  if (!t || !t.trialClass?.centerId) return null;
  return {
    sourceType: n.sourceType,
    sourceId: t.id,
    centerId: t.trialClass.centerId,
    orgUnitId: await donViCuaCoSo(tx, t.trialClass.centerId),
    ngay: t.date.toISOString().slice(0, 10),
    gioBatDau: t.startTime,
    gioKetThuc: t.endTime,
    activity: "TRIAL",
    trangThai: t.status,
    classId: null,
    tenLop: null,
    tenKhoa: null,
    ...macDinhCuaBuoi({ sourceType: "TRIAL_SESSION", trangThai: t.status, teacherId: t.teacherId, lopTrial: t.trialClass }),
  };
}

function nghiaVuCua(b: BuoiVanHanh, role: WorkRole): NghiaVu {
  return { sourceType: b.sourceType, sourceId: b.sourceId, centerId: b.centerId, role, ngay: b.ngay, gioBatDau: b.gioBatDau, gioKetThuc: b.gioKetThuc };
}

/** Khoá tư vấn theo BUỔI — mọi thao tác ghi phân công của MỘT buổi đi tuần tự (chống hai MAIN do hai tab). */
async function khoaBuoi(tx: Tx, n: Nguon) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`ssa:${n.sourceType}:${n.sourceId}`}))`;
}


function moTaBuoi(b: BuoiDayDu): string {
  const [y, m, d] = b.ngay.split("-");
  return `${b.tenLop ?? b.tenKhoa ?? "Buổi học"} · ${d}/${m}/${y} ${b.gioBatDau}–${b.gioKetThuc}`;
}

const NHAN_VAI: Record<WorkRole, string> = {
  MAIN_TEACHER: "giáo viên đứng chính",
  TEACHING_ASSISTANT: "trợ giảng",
  OPERATIONS_SUPPORT: "hỗ trợ vận hành",
};

// ─── Tạo phân công ────────────────────────────────────────────────────────────────────────────

export type KetQuaTao =
  | { ok: true; id: string; moi: boolean; thongBao: ThongBaoPhanCong[] }
  | { ok: false; loi: string };

export async function phanCongVaoBuoi(
  tx: Tx,
  p: {
    nguon: Nguon;
    userId: string;
    role: WorkRole;
    assignmentType: StaffAssignmentType;
    actor: NguoiThaoTac;
    sourceWorkRequestId?: string | null;
    replacesAssignmentId?: string | null;
    note?: string | null;
  },
): Promise<KetQuaTao> {
  await khoaBuoi(tx, p.nguon);
  const b = await docBuoi(tx, p.nguon);
  if (!b) return { ok: false, loi: "Không tìm thấy buổi" };
  if (b.tinhTrang !== "MO") return { ok: false, loi: b.lyDoDong ? `${b.lyDoDong} — không phân công được` : "Buổi đã kết thúc — không phân công được" };
  if (p.role === "OPERATIONS_SUPPORT") return { ok: false, loi: "Phân trực vận hành chưa mở (chờ chủ dự án chốt nguồn — Q3)" };
  if (!(await thamSoApDung(tx, b.ngay))) return { ok: false, loi: "Buổi trước 15/10/2026 thuộc chính sách cũ — không phân công theo SR.QD.238" };

  const song = await tx.sessionStaffAssignment.findMany({
    where: { sourceType: p.nguon.sourceType, sourceId: p.nguon.sourceId, status: { in: [...TRANG_THAI_SONG] } },
    select: { id: true, userId: true, role: true },
  });
  // Idempotent: cùng người cùng vai đã có phân công sống ⇒ trả lại nó, không tạo bản thứ hai.
  const trung = song.find((s) => s.userId === p.userId && s.role === p.role);
  if (trung) return { ok: true, id: trung.id, moi: false, thongBao: [] };
  if (p.role === "MAIN_TEACHER" && song.some((s) => s.role === "MAIN_TEACHER")) {
    return { ok: false, loi: "Buổi đã có giáo viên đứng chính — dùng thao tác thay giáo viên" };
  }
  if (song.some((s) => s.userId === p.userId)) {
    return { ok: false, loi: "Người này đã có vai khác trong buổi" };
  }

  const tao = await tx.sessionStaffAssignment.create({
    data: {
      sourceType: p.nguon.sourceType,
      sourceId: p.nguon.sourceId,
      centerId: b.centerId,
      orgUnitId: b.orgUnitId ?? undefined, // null ⇒ để ghi kép tự dò cầu nối mã
      ngay: new Date(`${b.ngay}T00:00:00.000Z`),
      gioBatDau: b.gioBatDau,
      gioKetThuc: b.gioKetThuc,
      userId: p.userId,
      role: p.role,
      activityType: b.activity,
      assignmentType: p.assignmentType,
      status: "WAITING_ACCEPTANCE",
      replacesAssignmentId: p.replacesAssignmentId ?? null,
      sourceWorkRequestId: p.sourceWorkRequestId ?? null,
      assignedById: p.actor.id,
      note: p.note ?? null,
    },
    select: { id: true },
  });
  await writeAudit({
    actor: p.actor,
    module: MODULE,
    entityType: ENTITY,
    entityId: tao.id,
    action: HANH_DONG.TAO,
    newValues: { nguon: p.nguon, userId: p.userId, role: p.role, assignmentType: p.assignmentType, activity: b.activity, ngay: b.ngay, gio: `${b.gioBatDau}-${b.gioKetThuc}`, sourceWorkRequestId: p.sourceWorkRequestId ?? null },
    tx,
  });
  await writeAudit({ actor: p.actor, module: MODULE, entityType: ENTITY, entityId: tao.id, action: HANH_DONG.YEU_CAU_XAC_NHAN, newValues: { userId: p.userId, phienBan: 1 }, tx });
  return {
    ok: true,
    id: tao.id,
    moi: true,
    thongBao: [
      {
        userId: p.userId,
        title: "Bạn có phân công cần xác nhận",
        body: `${p.actor.name} phân bạn làm ${NHAN_VAI[p.role]}${p.assignmentType === "SUBSTITUTE" ? " (dạy thay)" : ""}: ${moTaBuoi(b)}.`,
        href: HREF_GV,
        dedupeKey: `parttime.phan-cong:${tao.id}:v1`,
      },
    ],
  };
}

// ─── Xác nhận / từ chối nhận lớp ─────────────────────────────────────────────────────────────

export type KetQuaQuyetDinh = { ok: true; thongBao: ThongBaoPhanCong[] } | { ok: false; loi: string };

/**
 * Người ĐƯỢC PHÂN tự quyết. `nguoiBamId` là người đăng nhập (server lấy từ phiên — KHÔNG nhận từ client). Không có
 * nhánh "quản lý xác nhận thay" trong luồng thường.
 *
 * `phienBanDaXem` BẮT BUỘC (P3b, luật 7): phiên bản người bấm đang NHÌN trên màn. Lệch phiên bản hiện tại ⇒ từ chối —
 * lịch vừa đổi giữa lúc xem và lúc bấm thì "Nhận" là nhận một nghĩa vụ mình chưa đọc. Áp cho cả nhận lẻ lẫn "nhận cả
 * lớp" (mỗi mục mang phiên bản riêng).
 */
export async function quyetDinhNhanLop(
  tx: Tx,
  p: {
    assignmentId: string;
    nguoiBam: { id: string; name: string };
    quyetDinh: "ACCEPTED" | "DECLINED";
    phienBanDaXem: number;
    lyDo?: string | null;
    userAgent?: string | null;
    daXemLuc?: Date | null;
  },
): Promise<KetQuaQuyetDinh> {
  const pc0 = await tx.sessionStaffAssignment.findUnique({ where: { id: p.assignmentId }, select: { sourceType: true, sourceId: true } });
  if (!pc0) return { ok: false, loi: "Không tìm thấy phân công" };
  await khoaBuoi(tx, pc0);
  const pc = await tx.sessionStaffAssignment.findUniqueOrThrow({ where: { id: p.assignmentId } });
  if (pc.userId !== p.nguoiBam.id) return { ok: false, loi: "Chỉ người được phân mới xác nhận được phân công này" };
  if (pc.status !== "WAITING_ACCEPTANCE") return { ok: false, loi: "Phân công không ở trạng thái chờ xác nhận" };
  if (pc.assignmentVersion !== p.phienBanDaXem) return { ok: false, loi: "Lịch buổi vừa thay đổi — tải lại trang, xem phiên bản mới rồi xác nhận." };
  const lyDo = p.lyDo?.trim() ?? "";
  if (p.quyetDinh === "DECLINED" && lyDo.length < 5) return { ok: false, loi: "Ghi lý do từ chối (tối thiểu 5 ký tự)" };

  const b = await docBuoi(tx, pc);
  if (!b) return { ok: false, loi: "Không tìm thấy buổi" };
  if (b.tinhTrang !== "MO") return { ok: false, loi: b.lyDoDong ?? "Buổi đã kết thúc" };
  // Ngày thuộc chính sách cũ (dời về trước 15/10) ⇒ không còn phân công SR.QD.238 để nhận — kể cả khi công tắc tắt.
  if (!(await thamSoApDung(tx, b.ngay))) return { ok: false, loi: "Buổi trước 15/10/2026 thuộc chính sách cũ — không nhận phân công" };
  // Lịch buổi đã đổi so với lúc phân công ⇒ người bấm đang nhận một nghĩa vụ KHÁC thứ họ thấy. Từ chối — QLCS cập
  // nhật phân công (phiên bản mới) rồi mới nhận.
  const cu: NghiaVu = { sourceType: pc.sourceType, sourceId: pc.sourceId, centerId: pc.centerId, role: pc.role, ngay: pc.ngay.toISOString().slice(0, 10), gioBatDau: pc.gioBatDau, gioKetThuc: pc.gioKetThuc };
  const doi = doiDangKe(cu, nghiaVuCua(b, pc.role));
  if (doi.length > 0) return { ok: false, loi: "Lịch buổi đã thay đổi — chờ quản lý cập nhật phân công rồi xác nhận lại" };

  const den = p.quyetDinh === "ACCEPTED" ? "ACCEPTED" : "DECLINED";
  const ok = chuyenTrangThai(pc.status, den);
  if (!ok.ok) return { ok: false, loi: ok.loi };

  await tx.staffAssignmentAcceptance.create({
    data: {
      assignmentId: pc.id,
      assignmentVersion: pc.assignmentVersion,
      userId: pc.userId,
      decision: p.quyetDinh,
      roleSnapshot: pc.role,
      scheduleSnapshot: { ngay: cu.ngay, gioBatDau: pc.gioBatDau, gioKetThuc: pc.gioKetThuc, centerId: pc.centerId },
      classSnapshot: { nguon: { sourceType: pc.sourceType, sourceId: pc.sourceId }, lop: b.tenLop, khoa: b.tenKhoa, activity: pc.activityType, assignmentType: pc.assignmentType },
      requestedAt: pc.updatedAt,
      viewedAt: p.daXemLuc ?? null,
      decisionNote: lyDo || null,
      userAgent: p.userAgent?.slice(0, 300) ?? null,
      centerId: pc.centerId,
      orgUnitId: pc.orgUnitId ?? undefined,
    },
  });
  await tx.sessionStaffAssignment.update({ where: { id: pc.id }, data: { status: den } });
  await writeAudit({
    actor: p.nguoiBam,
    module: MODULE,
    entityType: ENTITY,
    entityId: pc.id,
    action: p.quyetDinh === "ACCEPTED" ? HANH_DONG.NHAN : HANH_DONG.TU_CHOI,
    oldValues: { status: pc.status },
    newValues: { status: den, phienBan: pc.assignmentVersion },
    reason: lyDo || undefined,
    tx,
  });
  const thongBao: ThongBaoPhanCong[] =
    p.quyetDinh === "DECLINED" && pc.assignedById
      ? [
          {
            userId: pc.assignedById,
            title: "Phân công bị từ chối — cần xếp người khác",
            body: `${NHAN_VAI[pc.role]} từ chối ${moTaBuoi(b)}. Lý do: ${lyDo}`,
            href: "/cham-cong/phan-cong",
            dedupeKey: `parttime.tu-choi:${pc.id}:v${pc.assignmentVersion}`,
          },
        ]
      : [];
  return { ok: true, thongBao };
}

// ─── Huỷ / thay / đồng bộ ─────────────────────────────────────────────────────────────────────

/**
 * QLCS GỬI LẠI nhắc xác nhận (P3b). Chỉ cho phân công ĐANG CHỜ NHẬN của buổi còn mở — không có nút đổi trạng thái, không
 * "nhận thay". Khoá thông báo mang PHIÊN BẢN (`parttime.nhac:<id>:v<n>`): nhắc lại cùng phiên bản thì MỞ LẠI đúng tin cũ
 * (không dội chuông mới), phiên bản đổi thì là tin mới. Có audit để biết ai nhắc, lúc nào.
 */
export async function nhacXacNhan(tx: Tx, p: { id: string; actor: NguoiThaoTac }): Promise<KetQuaQuyetDinh> {
  const pc = await tx.sessionStaffAssignment.findUnique({ where: { id: p.id } });
  if (!pc) return { ok: false, loi: "Không tìm thấy phân công." };
  if (pc.status !== "WAITING_ACCEPTANCE") return { ok: false, loi: "Chỉ nhắc được phân công đang chờ nhận." };
  const b = await docBuoi(tx, { sourceType: pc.sourceType, sourceId: pc.sourceId });
  if (!b || b.tinhTrang !== "MO") return { ok: false, loi: "Buổi đã đóng hoặc đã chốt — không nhắc." };
  await writeAudit({ actor: p.actor, module: MODULE, entityType: ENTITY, entityId: pc.id, action: HANH_DONG.NHAC, newValues: { userId: pc.userId, phienBan: pc.assignmentVersion }, tx });
  return {
    ok: true,
    thongBao: [
      {
        userId: pc.userId,
        title: "Nhắc: bạn có buổi chờ xác nhận",
        body: `Buổi ${pc.ngay.toISOString().slice(0, 10).split("-").reverse().join("/")} ${pc.gioBatDau}–${pc.gioKetThuc}. Vào "Công việc của tôi" để nhận hoặc từ chối.`,
        href: HREF_GV,
        dedupeKey: `parttime.nhac:${pc.id}:v${pc.assignmentVersion}`,
      },
    ],
  };
}

export async function huyPhanCong(tx: Tx, p: { id: string; actor: NguoiThaoTac; lyDo: string }): Promise<KetQuaQuyetDinh> {
  const lyDo = p.lyDo.trim();
  if (lyDo.length < 5) return { ok: false, loi: "Ghi lý do huỷ (tối thiểu 5 ký tự)" };
  const pc = await tx.sessionStaffAssignment.findUnique({ where: { id: p.id } });
  if (!pc) return { ok: false, loi: "Không tìm thấy phân công" };
  await khoaBuoi(tx, pc);
  const ok = chuyenTrangThai(pc.status, "CANCELLED");
  if (!ok.ok) return { ok: false, loi: ok.loi };
  await tx.sessionStaffAssignment.update({ where: { id: pc.id }, data: { status: "CANCELLED" } });
  await writeAudit({ actor: p.actor, module: MODULE, entityType: ENTITY, entityId: pc.id, action: HANH_DONG.HUY, oldValues: { status: pc.status }, newValues: { status: "CANCELLED" }, reason: lyDo, tx });
  return {
    ok: true,
    thongBao: [{ userId: pc.userId, title: "Phân công của bạn đã bị huỷ", body: lyDo, href: HREF_GV, dedupeKey: `parttime.huy:${pc.id}` }],
  };
}

/**
 * Đơn dạy thay đã duyệt / QLCS đổi GV: phân công MAIN sống cũ ⇒ REPLACED, phân công mới WAITING_ACCEPTANCE.
 * Idempotent theo `sourceWorkRequestId`: chạy lại cùng đơn không đẻ phân công thứ hai.
 *
 * KIỂU (P3a): có mã đơn ⇒ `SUBSTITUTE` — đường đơn ghi `ClassSession.substituteTeacherId` (qua `adjustSession`) nên bộ
 * đồng bộ thấy buổi "chống lưng" người thay. KHÔNG mã đơn (QLCS bấm "Đổi GV chính") ⇒ `MANUAL`: đường này không ghi trường
 * nào trên buổi, nên nếu mang `SUBSTITUTE` thì lần đồng bộ kế tiếp (dời lịch, sửa lớp, đổi TA…) coi nó là dẫn xuất được và
 * THAY về GV của lớp — mất lựa chọn của QLCS mà không ai báo (ca `[PT3A-25]`).
 */
export async function thayGiaoVienChinh(
  tx: Tx,
  p: { nguon: Nguon; gvMoiId: string; actor: NguoiThaoTac; sourceWorkRequestId: string | null; lyDo: string },
): Promise<KetQuaTao> {
  await khoaBuoi(tx, p.nguon);
  const mainSong = await tx.sessionStaffAssignment.findFirst({
    where: { sourceType: p.nguon.sourceType, sourceId: p.nguon.sourceId, role: "MAIN_TEACHER", status: { in: [...TRANG_THAI_SONG] } },
  });
  if (mainSong?.userId === p.gvMoiId) return { ok: true, id: mainSong.id, moi: false, thongBao: [] };
  if (mainSong) {
    if (mainSong.status === "COMPLETED") return { ok: false, loi: "Buổi đã chốt — không thay giáo viên được" };
    await tx.sessionStaffAssignment.update({ where: { id: mainSong.id }, data: { status: "REPLACED" } });
    await writeAudit({
      actor: p.actor,
      module: MODULE,
      entityType: ENTITY,
      entityId: mainSong.id,
      action: HANH_DONG.THAY,
      oldValues: { status: mainSong.status, userId: mainSong.userId },
      newValues: { status: "REPLACED", nguoiThay: p.gvMoiId, sourceWorkRequestId: p.sourceWorkRequestId },
      reason: p.lyDo,
      tx,
    });
  }
  const r = await phanCongVaoBuoi(tx, {
    nguon: p.nguon,
    userId: p.gvMoiId,
    role: "MAIN_TEACHER",
    assignmentType: p.sourceWorkRequestId ? "SUBSTITUTE" : "MANUAL",
    actor: p.actor,
    sourceWorkRequestId: p.sourceWorkRequestId,
    replacesAssignmentId: mainSong?.id ?? null,
  });
  if (!r.ok) throw new Error(`Không tạo được phân công dạy thay: ${r.loi}`); // đã ghi REPLACED ⇒ phải throw để rollback
  const thongBao = [...r.thongBao];
  if (mainSong && mainSong.status !== "DECLINED") {
    thongBao.push({ userId: mainSong.userId, title: "Phân công của bạn đã thay đổi", body: `Buổi được giao cho người dạy thay. ${p.lyDo}`, href: HREF_GV, dedupeKey: `parttime.thay:${mainSong.id}` });
  }
  return { ...r, thongBao };
}

/** Huỷ đơn dạy thay: phân công SUBSTITUTE của đơn ⇒ CANCELLED; người cũ được phân lại (phải xác nhận lại). */
export async function hoanTacThayGiaoVien(
  tx: Tx,
  p: { nguon: Nguon; sourceWorkRequestId: string; actor: NguoiThaoTac },
): Promise<{ thongBao: ThongBaoPhanCong[] }> {
  await khoaBuoi(tx, p.nguon);
  const thay = await tx.sessionStaffAssignment.findFirst({
    where: { sourceType: p.nguon.sourceType, sourceId: p.nguon.sourceId, sourceWorkRequestId: p.sourceWorkRequestId, role: "MAIN_TEACHER" },
    orderBy: { createdAt: "desc" },
  });
  if (!thay) return { thongBao: [] };
  const thongBao: ThongBaoPhanCong[] = [];
  if (TRANG_THAI_SONG.includes(thay.status) && thay.status !== "COMPLETED") {
    await tx.sessionStaffAssignment.update({ where: { id: thay.id }, data: { status: "CANCELLED" } });
    await writeAudit({ actor: p.actor, module: MODULE, entityType: ENTITY, entityId: thay.id, action: HANH_DONG.HUY, oldValues: { status: thay.status }, newValues: { status: "CANCELLED", vi: "huỷ đơn dạy thay" }, tx });
    thongBao.push({ userId: thay.userId, title: "Buổi dạy thay đã được huỷ", body: "Đơn dạy thay đã bị huỷ — bạn không còn phân công buổi này.", href: HREF_GV, dedupeKey: `parttime.huy:${thay.id}` });
  }
  if (thay.replacesAssignmentId) {
    const cu = await tx.sessionStaffAssignment.findUnique({ where: { id: thay.replacesAssignmentId }, select: { userId: true } });
    if (cu) {
      const r = await phanCongVaoBuoi(tx, { nguon: p.nguon, userId: cu.userId, role: "MAIN_TEACHER", assignmentType: "REGULAR", actor: p.actor, note: "Phân lại sau khi huỷ đơn dạy thay" });
      if (r.ok) thongBao.push(...r.thongBao);
    }
  }
  return { thongBao };
}

// ─── Nguyên tử dùng chung: huỷ / đổi lịch / thay một phân công ─────────────────────────────────

type DongPC = Prisma.SessionStaffAssignmentGetPayload<true>;

const nghiaVuCuaPC = (pc: DongPC): NghiaVu => ({
  sourceType: pc.sourceType,
  sourceId: pc.sourceId,
  centerId: pc.centerId,
  role: pc.role,
  ngay: pc.ngay.toISOString().slice(0, 10),
  gioBatDau: pc.gioBatDau,
  gioKetThuc: pc.gioKetThuc,
});

async function huyMot(tx: Tx, pc: DongPC, actor: NguoiThaoTac, lyDo: string, nguonKichHoat: string): Promise<ThongBaoPhanCong | null> {
  if (!chuyenTrangThai(pc.status, "CANCELLED").ok) return null;
  const r = await tx.sessionStaffAssignment.updateMany({ where: { id: pc.id, status: pc.status }, data: { status: "CANCELLED" } });
  if (r.count === 0) return null; // lượt khác vừa đổi — không ghi đè
  await writeAudit({ actor, module: MODULE, entityType: ENTITY, entityId: pc.id, action: HANH_DONG.HUY, oldValues: { status: pc.status }, newValues: { status: "CANCELLED", nguonKichHoat }, reason: lyDo, tx });
  return { userId: pc.userId, title: "Buổi bạn được phân đã bị huỷ", body: lyDo, href: HREF_GV, dedupeKey: `parttime.huy:${pc.id}` };
}

async function doiLichMot(tx: Tx, pc: DongPC, b: BuoiDayDu, actor: NguoiThaoTac, nguonKichHoat: string): Promise<ThongBaoPhanCong | null> {
  const cu = nghiaVuCuaPC(pc);
  const doi = doiDangKe(cu, nghiaVuCua(b, pc.role));
  if (doi.length === 0) return null;
  const phienMoi = pc.assignmentVersion + 1;
  await tx.sessionStaffAssignment.update({
    where: { id: pc.id },
    data: {
      ngay: new Date(`${b.ngay}T00:00:00.000Z`),
      gioBatDau: b.gioBatDau,
      gioKetThuc: b.gioKetThuc,
      centerId: b.centerId,
      // null ⇒ để trống (undefined) cho ghi kép tự dò cầu nối mã — truyền null tường minh là tắt ghi kép.
      orgUnitId: b.orgUnitId ?? undefined,
      assignmentVersion: phienMoi,
      status: "WAITING_ACCEPTANCE",
    },
  });
  await writeAudit({ actor, module: MODULE, entityType: ENTITY, entityId: pc.id, action: HANH_DONG.DOI, oldValues: cu, newValues: { ...nghiaVuCua(b, pc.role), truongDoi: doi, nguonKichHoat }, tx });
  if (pc.status === "ACCEPTED" || pc.status === "ACTIVE") {
    await writeAudit({ actor, module: MODULE, entityType: ENTITY, entityId: pc.id, action: HANH_DONG.VO_HIEU, newValues: { phienBanCu: pc.assignmentVersion, phienBanMoi: phienMoi, nguonKichHoat }, tx });
  }
  return { userId: pc.userId, title: "Phân công của bạn đã thay đổi", body: `Lịch đổi: ${moTaBuoi(b)} — vui lòng xác nhận lại.`, href: HREF_GV, dedupeKey: `parttime.phan-cong:${pc.id}:v${phienMoi}` };
}

/** Buổi bị huỷ: mọi phân công sống CHƯA chốt ⇒ CANCELLED (COMPLETED không đụng). */
export async function huyPhanCongCuaBuoi(tx: Tx, p: { nguon: Nguon; actor: NguoiThaoTac; lyDo: string }): Promise<{ thongBao: ThongBaoPhanCong[] }> {
  await khoaBuoi(tx, p.nguon);
  const song = await tx.sessionStaffAssignment.findMany({
    where: { sourceType: p.nguon.sourceType, sourceId: p.nguon.sourceId, status: { in: [...SONG_CHUA_CHOT] } },
  });
  const thongBao: ThongBaoPhanCong[] = [];
  for (const pc of song) {
    const t = await huyMot(tx, pc, p.actor, p.lyDo, "HUY_BUOI");
    if (t) thongBao.push(t);
  }
  return { thongBao };
}

/**
 * Lịch buổi đổi (ngày/giờ/cơ sở) ⇒ mọi phân công sống chưa chốt: cập nhật ảnh chụp, `assignmentVersion + 1`, về
 * WAITING_ACCEPTANCE ⇒ xác nhận cũ tự hết hiệu lực. Đổi KHÔNG đáng kể ⇒ không đụng gì. Buổi KHÔNG còn mở (đã chốt /
 * đã đóng) ⇒ KHÔNG đụng gì: đưa phân công của buổi đã đóng về "chờ nhận" là tạo một việc không bao giờ nhận được.
 */
export async function dongBoLichPhanCong(tx: Tx, p: { nguon: Nguon; actor: NguoiThaoTac }): Promise<{ soDoi: number; thongBao: ThongBaoPhanCong[] }> {
  await khoaBuoi(tx, p.nguon);
  const b = await docBuoi(tx, p.nguon);
  if (!b || b.tinhTrang !== "MO") return { soDoi: 0, thongBao: [] };
  const song = await tx.sessionStaffAssignment.findMany({
    where: { sourceType: p.nguon.sourceType, sourceId: p.nguon.sourceId, status: { in: [...SONG_CHUA_CHOT] } },
  });
  const thongBao: ThongBaoPhanCong[] = [];
  for (const pc of song) {
    const t = await doiLichMot(tx, pc, b, p.actor, "DOI_LICH");
    if (t) thongBao.push(t);
  }
  return { soDoi: thongBao.length, thongBao };
}

// ─── ĐỒNG BỘ theo trạng thái sống (P3a) — MỘT hàm cho mọi đường đổi buổi / lớp / học bù / trial ─────

export type NgoaiLeDongBo = { ma: string; role: WorkRole; userId: string | null; chiTiet: string };
export type KetQuaDongBo = { soBuoc: number; soTao: number; thongBao: ThongBaoPhanCong[]; ngoaiLe: NgoaiLeDongBo[] };

/**
 * Đọc trạng thái SỐNG của nguồn rồi làm cho phân công khớp với nó (kế hoạch: `keHoachDongBo`, THUẦN). Idempotent: chạy
 * lại không đổi gì. Gọi trong một giao dịch KHÔNG có scope (đọc `db` trần) — trong giao dịch có scope, phép đọc phân
 * công bị lọc theo phạm vi người thao tác và có thể bỏ sót dòng (⇒ tạo trùng MAIN bị chỉ mục chặn, hỏng cả nghiệp vụ).
 * Vì vậy đường nghiệp vụ KHÔNG gọi hàm này trong giao dịch của nó — chỉ đánh dấu (`lib/parttime/dong-bo.ts`).
 *
 * `chiDung` = chỉ làm các bước TẠO (nút "Dựng từ giáo viên của lớp" của QLCS) — cùng một luật dựng, không viết lại.
 *
 * `congTacBat` BẮT BUỘC, người gọi đọc `phanCongBat()` TRƯỚC khi mở giao dịch. Đọc nó ở đây (sau khoá tư vấn) là một
 * truy vấn `db` trần lồng trong giao dịch: N lượt đồng bộ cùng buổi giữ N kết nối chờ khoá, kẻ giữ khoá cần kết nối thứ
 * N+1 cho cờ ⇒ cạn pool (`connection_limit` = 5) và cả N cùng treo tới hết `pool_timeout`. Đo được: 5 lượt song song
 * treo 20 giây ở pool 5, xanh trong 2 giây ở pool 20 (ca `[PT3A-12]`).
 */
export async function dongBoPhanCongTheoNguon(
  tx: Tx,
  nguon: Nguon,
  ctx: { actor: NguoiThaoTac; nguonKichHoat: string; congTacBat: boolean; chiDung?: boolean },
): Promise<KetQuaDongBo> {
  await khoaBuoi(tx, nguon);
  const [b, rows] = await Promise.all([
    docBuoi(tx, nguon),
    tx.sessionStaffAssignment.findMany({ where: { sourceType: nguon.sourceType, sourceId: nguon.sourceId }, orderBy: { createdAt: "asc" } }),
  ]);
  const ketQua: KetQuaDongBo = { soBuoc: 0, soTao: 0, thongBao: [], ngoaiLe: [] };

  let buoc: BuocDongBo[];
  if (!b) {
    // Nguồn không còn đọc được (đã xoá / mất cơ sở) ⇒ phân công sống chưa chốt không còn nghĩa vụ nào để nhận.
    buoc = rows.filter((r) => SONG_CHUA_CHOT.includes(r.status)).map((r) => ({ loai: "HUY" as const, id: r.id, lyDo: "Buổi không còn tồn tại" }));
  } else {
    const ts = await thamSoApDung(tx, b.ngay);
    const bat = ctx.congTacBat;
    buoc = keHoachDongBo(
      {
        tinhTrang: b.tinhTrang,
        lyDoDong: b.lyDoDong,
        apDung: ts != null,
        congTacBat: bat,
        lich: { sourceType: b.sourceType, sourceId: b.sourceId, centerId: b.centerId, ngay: b.ngay, gioBatDau: b.gioBatDau, gioKetThuc: b.gioKetThuc },
        main: b.macDinhMainId ? { userId: b.macDinhMainId, kieu: b.macDinhMainKieu } : null,
        ta: b.macDinhTaId ? { userId: b.macDinhTaId } : null,
        nguoiDayThay: b.nguoiDayThay,
      },
      rows.map((r) => ({ id: r.id, userId: r.userId, role: r.role, status: r.status, assignmentType: r.assignmentType, nghiaVu: nghiaVuCuaPC(r) })),
    );
  }
  if (ctx.chiDung) buoc = buoc.filter((x) => x.loai === "TAO");
  ketQua.soBuoc = buoc.length;

  const theoId = new Map(rows.map((r) => [r.id, r]));
  const note = `Đồng bộ tự động (${ctx.nguonKichHoat})`;
  for (const x of buoc) {
    if (x.loai === "NGOAI_LE") {
      ketQua.ngoaiLe.push({ ma: x.ma, role: x.role, userId: x.userId, chiTiet: x.chiTiet });
      continue;
    }
    if (x.loai === "HUY") {
      const pc = theoId.get(x.id);
      const t = pc ? await huyMot(tx, pc, ctx.actor, x.lyDo, ctx.nguonKichHoat) : null;
      if (t) ketQua.thongBao.push(t);
      continue;
    }
    if (!b) continue;
    if (x.loai === "DOI_LICH") {
      const pc = theoId.get(x.id);
      const t = pc ? await doiLichMot(tx, pc, b, ctx.actor, ctx.nguonKichHoat) : null;
      if (t) ketQua.thongBao.push(t);
      continue;
    }
    if (x.loai === "THAY") {
      const cu = theoId.get(x.cuId);
      if (!cu || !chuyenTrangThai(cu.status, "REPLACED").ok) continue;
      await tx.sessionStaffAssignment.update({ where: { id: cu.id }, data: { status: "REPLACED" } });
      await writeAudit({
        actor: ctx.actor,
        module: MODULE,
        entityType: ENTITY,
        entityId: cu.id,
        action: HANH_DONG.THAY,
        oldValues: { status: cu.status, userId: cu.userId },
        newValues: { status: "REPLACED", nguoiThay: x.userId, nguonKichHoat: ctx.nguonKichHoat },
        reason: "Người mặc định của buổi đã đổi",
        tx,
      });
      if (cu.status !== "DECLINED") {
        ketQua.thongBao.push({ userId: cu.userId, title: "Phân công của bạn đã thay đổi", body: `Buổi được giao cho người khác: ${moTaBuoi(b)}.`, href: HREF_GV, dedupeKey: `parttime.thay:${cu.id}` });
      }
    }
    // THAY (phần người mới) và TAO cùng đi qua cửa tạo duy nhất.
    const r = await phanCongVaoBuoi(tx, {
      nguon,
      userId: x.userId,
      role: x.role,
      assignmentType: x.kieu,
      actor: ctx.actor,
      replacesAssignmentId: x.loai === "THAY" ? x.cuId : null,
      note,
    });
    if (!r.ok) {
      // THAY đã ghi REPLACED ⇒ không được để buổi mất người âm thầm: ném để giao dịch của NGUỒN này quay lui.
      if (x.loai === "THAY") throw new Error(`Đồng bộ phân công: không tạo được người thay — ${r.loi}`);
      ketQua.ngoaiLe.push({ ma: "KHONG_TAO_DUOC", role: x.role, userId: x.userId, chiTiet: r.loi });
      continue;
    }
    if (r.moi) {
      ketQua.soTao++;
      ketQua.thongBao.push(...r.thongBao);
    }
  }
  return ketQua;
}

/**
 * Dựng phân công MẶC ĐỊNH cho một buổi (nút "Dựng từ giáo viên của lớp"). Cùng luật với đồng bộ (`chiDung`): vai đã có
 * người sống ⇒ bỏ qua; người đã TỪ CHỐI đúng vai đó ⇒ không dựng lại đúng người đó (QLCS xếp người khác).
 */
export async function dungPhanCongMacDinh(tx: Tx, p: { nguon: Nguon; actor: NguoiThaoTac }): Promise<{ soTao: number; thongBao: ThongBaoPhanCong[] }> {
  const r = await dongBoPhanCongTheoNguon(tx, p.nguon, { actor: p.actor, nguonKichHoat: "QLCS_DUNG_MAC_DINH", congTacBat: await phanCongBat(), chiDung: true });
  return { soTao: r.soTao, thongBao: r.thongBao };
}

/**
 * Đổi GHI CHÚ của phân công — KHÔNG đáng kể: giữ phiên bản, giữ trạng thái, xác nhận cũ vẫn hiệu lực. Đổi thứ khác
 * (người · vai · lịch · cơ sở) không đi qua đây: người/vai = huỷ + phân mới; lịch = `dongBoLichPhanCong`.
 */
export async function doiGhiChuPhanCong(tx: Tx, p: { id: string; note: string | null; actor: NguoiThaoTac }): Promise<{ ok: true } | { ok: false; loi: string }> {
  const pc = await tx.sessionStaffAssignment.findUnique({ where: { id: p.id }, select: { id: true, note: true, status: true } });
  if (!pc) return { ok: false, loi: "Không tìm thấy phân công" };
  if (!TRANG_THAI_SONG.includes(pc.status)) return { ok: false, loi: "Phân công đã kết thúc — không sửa được" };
  const note = p.note?.trim() || null;
  if (note === pc.note) return { ok: true };
  await tx.sessionStaffAssignment.update({ where: { id: pc.id }, data: { note } });
  await writeAudit({ actor: p.actor, module: MODULE, entityType: ENTITY, entityId: pc.id, action: HANH_DONG.DOI, oldValues: { note: pc.note }, newValues: { note, dangKe: false }, tx });
  return { ok: true };
}

/** Số phân công gắn với buổi (mọi trạng thái) — cổng xoá cứng buổi. */
export async function soPhanCongCuaBuoi(tx: Tx | typeof db, n: Nguon): Promise<number> {
  return tx.sessionStaffAssignment.count({ where: { sourceType: n.sourceType, sourceId: n.sourceId } });
}

// ─── Trợ giảng bắt buộc + trạng thái nhân lực ─────────────────────────────────────────────────

/** TA có bắt buộc cho buổi không: QLCS ghi đè (theo lớp) thắng; không thì PL02; khoá ngoài bảng ⇒ OPTIONAL (QLCS quyết). */
export type { YeuCauTroGiang };

export async function yeuCauTroGiang(tx: Tx | typeof db, b: BuoiDayDu, ts: ThamSoSrQd238 | null): Promise<YeuCauTroGiang> {
  if (!b.classId) return "OPTIONAL";
  const [gd, soHocVien] = await Promise.all([
    tx.classStaffingRequirement.findUnique({ where: { classId: b.classId }, select: { taRequired: true } }),
    tx.enrollment.count({ where: { classId: b.classId, deletedAt: null, status: { in: [...ENROLLMENT_ACTIVE_STATUS_LIST] } } }),
  ]);
  return yeuCauTroGiangThuan({ ghiDe: gd?.taRequired ?? null, tenKhoa: b.tenKhoa, soHocVien, nguong: ts?.nguongTroGiang ?? null });
}

export async function datYeuCauTroGiang(
  tx: Tx,
  p: { classId: string; taRequired: boolean; lyDo: string; actor: NguoiThaoTac },
): Promise<{ ok: true } | { ok: false; loi: string }> {
  const lyDo = p.lyDo.trim();
  if (lyDo.length < 5) return { ok: false, loi: "Ghi lý do (tối thiểu 5 ký tự)" };
  const lop = await tx.class.findUnique({ where: { id: p.classId }, select: { centerId: true } });
  if (!lop?.centerId) return { ok: false, loi: "Không tìm thấy lớp" };
  const truoc = await tx.classStaffingRequirement.findUnique({ where: { classId: p.classId }, select: { taRequired: true } });
  await tx.classStaffingRequirement.upsert({
    where: { classId: p.classId },
    create: { classId: p.classId, centerId: lop.centerId, orgUnitId: (await donViCuaCoSo(tx, lop.centerId)) ?? undefined, taRequired: p.taRequired, reason: lyDo, decidedById: p.actor.id },
    update: { taRequired: p.taRequired, reason: lyDo, decidedById: p.actor.id, decidedAt: new Date() },
  });
  await writeAudit({ actor: p.actor, module: MODULE, entityType: "ClassStaffingRequirement", entityId: p.classId, action: HANH_DONG.YEU_CAU_TA, oldValues: truoc ?? undefined, newValues: { taRequired: p.taRequired }, reason: lyDo, tx });
  return { ok: true };
}

export type NhanLucBuoi = {
  trangThai: TrangThaiNhanLuc;
  yeuCauTA: YeuCauTroGiang;
  phanCong: { id: string; userId: string; role: WorkRole; status: StaffAssignmentStatus; assignmentType: StaffAssignmentType; phienBan: number; daNhan: boolean }[];
};

export async function docNhanLucBuoi(tx: Tx | typeof db, n: Nguon): Promise<NhanLucBuoi | null> {
  const b = await docBuoi(tx as Tx, n);
  if (!b) return null;
  const ts = await thamSoApDung(tx as Tx, b.ngay);
  const [pcs, yc] = await Promise.all([
    tx.sessionStaffAssignment.findMany({
      where: { sourceType: n.sourceType, sourceId: n.sourceId },
      orderBy: { createdAt: "asc" },
      include: { acceptances: { select: { assignmentVersion: true, decision: true } } },
    }),
    yeuCauTroGiang(tx, b, ts),
  ]);
  const rows = pcs.map((pc) => ({
    id: pc.id,
    userId: pc.userId,
    role: pc.role,
    status: pc.status,
    assignmentType: pc.assignmentType,
    phienBan: pc.assignmentVersion,
    daNhan: xacNhanConHieuLuc(pc.acceptances, pc.assignmentVersion) != null,
  }));
  return { trangThai: trangThaiNhanLuc(rows, laTaBatBuoc(yc)), yeuCauTA: yc, phanCong: rows };
}

/**
 * Cổng XOÁ CỨNG buổi (`deleteSession`): buổi đã có phân công (kể cả đã từ chối/huỷ) ⇒ CHẶN. Xoá là làm mồ côi phân công
 * và mất dấu vết xác nhận nhận lớp (bản ghi bất biến, khoá ngoại RESTRICT). Muốn bỏ buổi thì HUỶ buổi.
 */
export async function chanXoaBuoiCoPhanCong(sessionId: string): Promise<string | null> {
  const n = await soPhanCongCuaBuoi(db, { sourceType: "CLASS_SESSION", sourceId: sessionId });
  return n > 0 ? `Buổi đã có ${n} phân công nhân sự — không xoá được. Hãy huỷ buổi thay vì xoá.` : null;
}
