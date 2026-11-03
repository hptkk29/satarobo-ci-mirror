import "server-only";
import { db } from "@/lib/db";
import type { scopedDb } from "@/lib/db-scope";
import { duyetYeuCauHocVuot, thuHoiBaoHocVuot, tuChoiYeuCauHocVuot } from "@/lib/orders/hoc-vuot-chuyen-doi";

// lib/orders/hoc-vuot-cho-duyet.ts — đọc + xử lý HÀNG CHỜ DUYỆT HỌC VƯỢT BÙ của màn `/hoc-bu/duyet-hoc-vuot` [27/10/2026].
// Đọc qua `scopedDb` (bảng `EnrollmentCatchUpRequest` thuộc SCOPED_MODELS): QLCS chỉ thấy yêu cầu của cơ sở mình. Quyền `makeup:waive` gác ở trang + từng Server Action.

type Sdb = ReturnType<typeof scopedDb>;

export type DongChoDuyetHocVuot = {
  id: string;
  status: "PENDING" | "APPROVED" | "REJECTED" | "CANCELLED";
  tenBe: string;
  tenLop: string;
  tenKhoa: string;
  centerId: string;
  orderId: string;
  maDon: string;
  startLesson: number;
  sessionsToCatchUp: number;
  makeupSessions: number;
  nguoiGui: string;
  guiLuc: Date;
  nguoiQuyet: string | null;
  quyetLuc: Date | null;
  lyDoQuyet: string | null;
};

async function doc(sdb: Sdb, trangThai: ("PENDING" | "APPROVED" | "REJECTED" | "CANCELLED")[], take: number): Promise<DongChoDuyetHocVuot[]> {
  const rows = await sdb.enrollmentCatchUpRequest.findMany({
    where: { status: { in: trangThai } },
    orderBy: trangThai.length === 1 && trangThai[0] === "PENDING" ? { proposedAt: "asc" } : { updatedAt: "desc" },
    take,
  });
  if (rows.length === 0) return [];
  const uniq = (xs: string[]) => [...new Set(xs)];
  const [hv, lop, khoa, don, nguoi] = await Promise.all([
    sdb.student.findMany({ where: { id: { in: uniq(rows.map((r) => r.studentId)) } }, select: { id: true, name: true } }),
    sdb.class.findMany({ where: { id: { in: uniq(rows.map((r) => r.classId)) } }, select: { id: true, name: true } }),
    sdb.course.findMany({ where: { id: { in: uniq(rows.map((r) => r.courseId)) } }, select: { id: true, name: true } }),
    sdb.order.findMany({ where: { id: { in: uniq(rows.map((r) => r.orderId)) } }, select: { id: true, code: true } }),
    db.user.findMany({
      where: { id: { in: uniq(rows.flatMap((r) => [r.proposedById, r.decidedById].filter((x): x is string => !!x))) } },
      select: { id: true, name: true },
    }),
  ]);
  const ten = (xs: { id: string; name: string | null }[]) => new Map(xs.map((x) => [x.id, x.name ?? ""] as const));
  const tHv = ten(hv);
  const tLop = ten(lop);
  const tKhoa = ten(khoa);
  const tNguoi = ten(nguoi);
  const tDon = new Map(don.map((d) => [d.id, d.code]));
  return rows.map((r) => ({
    id: r.id,
    status: r.status,
    tenBe: tHv.get(r.studentId) ?? "Học viên",
    tenLop: tLop.get(r.classId) ?? "Lớp",
    tenKhoa: tKhoa.get(r.courseId) ?? "Khoá học",
    centerId: r.centerId,
    orderId: r.orderId,
    maDon: tDon.get(r.orderId) ?? r.orderId,
    startLesson: r.startLesson,
    sessionsToCatchUp: r.sessionsToCatchUp,
    makeupSessions: r.makeupSessions,
    nguoiGui: tNguoi.get(r.proposedById) ?? "Nhân viên",
    guiLuc: r.proposedAt,
    nguoiQuyet: r.decidedById ? (tNguoi.get(r.decidedById) ?? "Người duyệt") : null,
    quyetLuc: r.decidedAt,
    lyDoQuyet: r.decisionReason,
  }));
}

export const docYeuCauChoDuyet = (sdb: Sdb) => doc(sdb, ["PENDING"], 200);
/** Đã xử lý gần đây — để người duyệt đối chiếu, không phải hàng đợi. */
export const docYeuCauDaXuLy = (sdb: Sdb) => doc(sdb, ["APPROVED", "REJECTED", "CANCELLED"], 20);

/** Yêu cầu có thuộc tầm nhìn cơ sở của người gọi không (cổng IDOR của action). Trả `centerId` hoặc `null`. */
export async function coSoCuaYeuCau(sdb: Sdb, requestId: string): Promise<string | null> {
  const r = await sdb.enrollmentCatchUpRequest.findFirst({ where: { id: requestId }, select: { centerId: true } });
  return r?.centerId ?? null;
}

type Nguoi = { id: string | null; name: string };

/** DUYỆT trong một giao dịch rồi thu hồi chuông (không bao giờ ném). Người gọi PHẢI đã kiểm `makeup:waive` + tầm nhìn cơ sở. */
export async function duyetHocVuotCoGiaoDich(requestId: string, centerId: string, nguoi: Nguoi, bayGio: Date) {
  const kq = await db.$transaction((tx) => duyetYeuCauHocVuot(tx, requestId, nguoi, bayGio));
  if (kq.ok) await thuHoiBaoHocVuot({ requestId, centerId });
  return kq;
}

export async function tuChoiHocVuotCoGiaoDich(requestId: string, centerId: string, nguoi: Nguoi, bayGio: Date, lyDo: string) {
  const kq = await db.$transaction((tx) => tuChoiYeuCauHocVuot(tx, requestId, nguoi, bayGio, lyDo));
  if (kq.ok) await thuHoiBaoHocVuot({ requestId, centerId });
  return kq;
}
