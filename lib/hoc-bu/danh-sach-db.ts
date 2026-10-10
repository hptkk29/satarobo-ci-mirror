import "server-only";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import type { scopedDb } from "@/lib/db-scope";
import { docHinhThucLop } from "@/lib/orders/hinh-thuc-lop";
import { docConLeadTuMetadata } from "@/lib/orders/hoc-vien-dong-don";
import { locDonNhanTien } from "@/lib/payments/don-nhan-tien";
import { deriveSessionLabel } from "@/lib/lms/session-project-name";
import { KHOAN_DA_GHI_NHAN } from "@/lib/finance/ghi-nhan";
import { tongLuotBu, conLuotBu } from "@/lib/hoc-bu/luot-bu";
import {
  hocPhanCuaKhoa,
  soBuoiMuaCuaBe,
  viTriHocPhanBatDau,
  type DongDonCuaBe,
} from "@/lib/hoc-bu/dong-can-bu";
import { trangThaiPhi, duocXep, type TrangThaiPhi, type KetQuaXep } from "@/lib/hoc-bu/xep-case";
import { timHocVienBu } from "@/lib/hoc-bu/loc";

// DANH SÁCH CẦN BÙ (docs/hoc-bu/DAC-TA.md §2). Đọc qua `scopedDb` của người xem — MakeupNeed
// ∈ SCOPED_MODELS nên mỗi cơ sở chỉ thấy học viên của mình (chốt 3: không chéo cơ sở).
//
// Riêng DÒNG ĐƠN (số buổi mua) và TIỀN PHÍ BÙ đọc bằng `db` trần: đó là đầu vào để TÍNH lượt
// và cổng "đã thu tiền chưa", không phải dữ liệu bày ra — người xem là Sale/quản lý lớp, có
// người không có quyền đơn hàng, và cắt theo quyền của họ là tính sai lượt mà không báo gì.
//
// `boSungDong` dùng CHUNG cho màn hình và cho server action xếp case: nút mở trên màn và cổng
// ở máy chủ phải tính trên cùng một phép (luật 12).

/**
 * Dữ liệu học bù cũ BỎ QUA (chốt 12) — chỉ nhận buổi vắng ghi nhận từ 20/09/2026.
 * 02/10/2026 (lần 2) chủ dự án: "lấy data từ 20/9" — kèm `scripts/bu-vang-tu-ngay.ts` tạo dòng
 * chờ bù cho buổi vắng từ 20/09 chưa có MakeupNeed (vắng có phép theo luật cũ).
 * 02/10/2026 chủ dự án lùi mốc 01/10 → 30/09: đo prod, buổi vắng điểm danh TỐI 30/09 (18:13)
 * bị mốc cũ loại dù người dùng coi là dữ liệu mới.
 */
export const HOC_BU_TU_NGAY = new Date("2026-09-20T00:00:00+07:00");

type Sdb = ReturnType<typeof scopedDb>;

export type DongCanBu = {
  id: string;
  studentId: string;
  hocVien: string;
  lop: string;
  khoa: string;
  centerId: string | null;
  courseId: string;
  /** Bài của buổi vắng = buổi bù. null ⇒ không nhóm được với ai. */
  lessonId: string | null;
  ngayVang: Date | null;
  /** Nhãn buổi chuẩn ("Buổi 14 - HP2 - Tên bài"), `deriveSessionLabel`. */
  buoiVang: string | null;
  luot: { tong: number; daDung: number; con: number };
  phi: TrangThaiPhi;
  xep: KetQuaXep;
  /** Đơn "xin học bù" phụ huynh gửi cho ĐÚNG buổi này (hoặc đơn chung chưa chỉ buổi). */
  donPhuHuynh: { dungBuoi: boolean; ngayMongMuon: Date | null } | null;
};

export type LocCanBu = {
  trang: number;
  soDong: number;
  centerId?: string;
  courseId?: string;
  /** Lọc một lớp (lớp của buổi vắng). */
  classId?: string;
  /** Chuỗi tìm đã chuẩn hoá (`chuanHoaTim`) — tên / mã học viên / tên lớp. */
  tim?: string;
  /**
   * Sale (không có `makeup:view-all`) chỉ thấy học viên mình PHỤ TRÁCH — BẮT BUỘC khai (luật 7):
   * `null` = thấy mọi học viên trong tầm nhìn cơ sở; id = chỉ học viên của Sale đó.
   */
  chiCuaSale: string | null;
};

/**
 * "Học viên do Sale X phụ trách" — cùng định nghĩa màn chat (`lib/chat/dm.ts`):
 * `Enrollment.saleId`, rơi về Sale của phiếu lead khi ghi danh chưa gán Sale.
 */
export function hocVienCuaSale(saleId: string): Prisma.StudentWhereInput {
  return {
    OR: [
      { enrollments: { some: { saleId, deletedAt: null } } },
      { enrollments: { none: { saleId: { not: null }, deletedAt: null } }, lead: { assignedToId: saleId } },
    ],
  };
}

export function whereCanBu(loc: Omit<LocCanBu, "trang" | "soDong">): Prisma.MakeupNeedWhereInput {
  return {
    status: "PENDING",
    waivedAt: null,
    createdAt: { gte: HOC_BU_TU_NGAY },
    class: {
      deletedAt: null,
      course: { choPhepHocBu: true },
      ...(loc.courseId ? { courseId: loc.courseId } : {}),
      ...(loc.classId ? { id: loc.classId } : {}),
    },
    ...(loc.centerId ? { centerId: loc.centerId } : {}),
    ...(loc.chiCuaSale ? { student: hocVienCuaSale(loc.chiCuaSale) } : {}),
    // Tìm đứng trong AND: `student` ở trên đã là khoá của lọc Sale — gộp phẳng là ghi đè nhau.
    ...(loc.tim ? { AND: [timHocVienBu(loc.tim)] } : {}),
  };
}

export async function docDanhSachCanBu(
  sdb: Sdb,
  loc: LocCanBu,
): Promise<{ dong: DongCanBu[]; tong: number; trang: number; soTrang: number }> {
  const where = whereCanBu(loc);
  const tong = await sdb.makeupNeed.count({ where });
  const soTrang = Math.max(1, Math.ceil(tong / loc.soDong));
  const trangDung = Math.min(Math.max(1, Math.floor(loc.trang) || 1), soTrang);

  const needs = await sdb.makeupNeed.findMany({
    where,
    // Gom bé CÙNG buổi đứng cạnh nhau — người xếp case nhìn một lượt là thấy nhóm.
    orderBy: [{ centerId: "asc" }, { missedLessonId: "asc" }, { createdAt: "asc" }, { id: "asc" }],
    skip: (trangDung - 1) * loc.soDong,
    take: loc.soDong,
    select: CHON_NEED,
  });
  return { dong: await boSungDong(sdb, needs), tong, trang: trangDung, soTrang };
}

/** Đọc lại đúng các dòng (đang chờ bù) theo id — cho server action xếp case / tạo phí. */
export async function docDongTheoId(sdb: Sdb, ids: readonly string[]): Promise<DongCanBu[]> {
  if (ids.length === 0) return [];
  const needs = await sdb.makeupNeed.findMany({
    where: { id: { in: [...ids] }, status: "PENDING", waivedAt: null },
    select: CHON_NEED,
  });
  return boSungDong(sdb, needs);
}

const CHON_NEED = {
  id: true,
  studentId: true,
  classId: true,
  centerId: true,
  missedSessionId: true,
  missedLessonId: true,
  feeOrderItemId: true,
  freeApprovedAt: true,
  /** `PHUC_HOC` (Bảo lưu BR-22): buổi bù sinh khi phục học vào lớp đi trước — miễn phí, KHÔNG trừ hạn mức. */
  nguon: true,
  student: { select: { name: true, leadChildId: true } },
  class: {
    select: {
      name: true,
      centerId: true,
      courseId: true,
      course: { select: { id: true, name: true, totalSessions: true, choPhepHocBu: true } },
    },
  },
} satisfies Prisma.MakeupNeedSelect;

type NeedTho = Prisma.MakeupNeedGetPayload<{ select: typeof CHON_NEED }>;

async function boSungDong(sdb: Sdb, needs: NeedTho[]): Promise<DongCanBu[]> {
  if (needs.length === 0) return [];

  const courseIds = [...new Set(needs.map((n) => n.class.courseId))];
  const studentIds = [...new Set(needs.map((n) => n.studentId))];
  const classIds = [...new Set(needs.map((n) => n.classId))];
  const leadChildIds = [
    ...new Set(needs.map((n) => n.student.leadChildId).filter((x): x is string => !!x)),
  ];
  const feeItemIds = needs.map((n) => n.feeOrderItemId).filter((x): x is string => !!x);

  const [bai, cauHinh, buoiVang, ghiDanh, diemDanh, daDung, dangGiu, donPh, phiItems] = await Promise.all([
    sdb.lesson.findMany({
      where: { archivedAt: null, curriculum: { courseId: { in: courseIds }, isActive: true } },
      select: { moduleCode: true, order: true, curriculum: { select: { courseId: true } } },
    }),
    sdb.courseModuleMakeupQuota.findMany({
      where: { courseId: { in: courseIds } },
      select: { courseId: true, moduleCode: true, luotBu: true },
    }),
    sdb.classSession.findMany({
      where: { id: { in: needs.map((n) => n.missedSessionId) } },
      select: {
        id: true,
        date: true,
        topic: true,
        lesson: { select: { order: true, title: true, moduleCode: true } },
      },
    }),
    sdb.enrollment.findMany({
      where: { studentId: { in: studentIds }, classId: { in: classIds }, deletedAt: null },
      select: { id: true, studentId: true, classId: true },
    }),
    sdb.attendance.findMany({
      where: { studentId: { in: studentIds }, session: { classId: { in: classIds } } },
      select: {
        studentId: true,
        session: { select: { classId: true, date: true, lesson: { select: { moduleCode: true } } } },
      },
    }),
    // Lượt ĐÃ TIÊU: buổi bù đã học bằng lượt.
    sdb.makeupNeed.groupBy({
      by: ["studentId", "classId"],
      where: { studentId: { in: studentIds }, classId: { in: classIds }, usedQuota: true },
      _count: { _all: true },
    }),
    // Lượt ĐANG GIỮ: đã xếp vào case bằng lượt, chưa điểm danh — không trừ thì hai buổi vắng
    // của cùng một bé cùng xếp được bằng lượt cuối cùng.
    db.makeupCaseStudent.findMany({
      where: {
        status: "PLACED",
        dungLuot: true,
        makeupNeed: { studentId: { in: studentIds }, classId: { in: classIds } },
      },
      select: { makeupNeed: { select: { studentId: true, classId: true } } },
    }),
    sdb.parentRequest.findMany({
      where: { studentId: { in: studentIds }, type: "MAKEUP", status: { in: ["PENDING", "APPROVED"] } },
      select: { studentId: true, sessionId: true, preferredDate: true },
      orderBy: { createdAt: "desc" },
    }),
    feeItemIds.length
      ? db.orderItem.findMany({
          where: { id: { in: feeItemIds } },
          select: { id: true, order: { select: { id: true, totalAmount: true, status: true, deletedAt: true } } },
        })
      : Promise.resolve([]),
  ]);

  const enrollmentIds = ghiDanh.map((e) => e.id);
  const orderIdsPhi = phiItems.map((p) => p.order.id);
  const [dongDon, daThuPhi] = await Promise.all([
    db.orderItem.findMany({
      where: {
        type: "COURSE_ENROLLMENT",
        order: locDonNhanTien(),
        OR: [
          { studentId: { in: studentIds } },
          { enrollmentId: { in: enrollmentIds } },
          ...leadChildIds.map((id) => ({ metadata: { path: ["leadChildId"], equals: id } })),
        ],
      },
      select: { studentId: true, enrollmentId: true, metadata: true },
    }),
    orderIdsPhi.length
      ? db.payment.groupBy({
          by: ["orderId"],
          where: { orderId: { in: orderIdsPhi }, ...KHOAN_DA_GHI_NHAN },
          _sum: { amount: true },
        })
      : Promise.resolve([]),
  ]);

  const baiTheoKhoa = new Map<string, { moduleCode: string | null; order: number }[]>();
  for (const b of bai) {
    const k = b.curriculum.courseId;
    (baiTheoKhoa.get(k) ?? baiTheoKhoa.set(k, []).get(k)!).push(b);
  }
  const cauHinhTheoKhoa = new Map<string, Map<string, number>>();
  for (const c of cauHinh) {
    (cauHinhTheoKhoa.get(c.courseId) ?? cauHinhTheoKhoa.set(c.courseId, new Map()).get(c.courseId)!).set(
      c.moduleCode,
      c.luotBu,
    );
  }
  const buoiTheoId = new Map(buoiVang.map((s) => [s.id, s]));
  const ghiDanhTheoCap = new Map(ghiDanh.map((e) => [`${e.studentId}|${e.classId}`, e.id]));
  const buoiDau = new Map<string, { t: number; ma: string | null }>();
  for (const a of diemDanh) {
    const k = `${a.studentId}|${a.session.classId}`;
    const t = a.session.date.getTime();
    const cu = buoiDau.get(k);
    if (!cu || t < cu.t) buoiDau.set(k, { t, ma: a.session.lesson?.moduleCode ?? null });
  }
  const daDungTheoCap = new Map(daDung.map((r) => [`${r.studentId}|${r.classId}`, r._count._all]));
  for (const g of dangGiu) {
    const k = `${g.makeupNeed.studentId}|${g.makeupNeed.classId}`;
    daDungTheoCap.set(k, (daDungTheoCap.get(k) ?? 0) + 1);
  }
  const thuTheoDon = new Map(daThuPhi.map((r) => [r.orderId, r._sum.amount ?? 0]));
  const phiTheoItem = new Map(
    phiItems
      // Đơn phí đã huỷ/xoá ⇒ coi như chưa tạo phí (tạo lại được).
      .filter((p) => p.order.deletedAt === null && p.order.status !== "CANCELLED" && p.order.status !== "REFUNDED")
      .map((p) => [
        p.id,
        { orderId: p.order.id, daThuDu: (thuTheoDon.get(p.order.id) ?? 0) >= p.order.totalAmount },
      ]),
  );

  return needs.map((n) => {
    const cap = `${n.studentId}|${n.classId}`;
    const khoa = n.class.course;
    const hocPhan = hocPhanCuaKhoa(baiTheoKhoa.get(khoa.id) ?? [], cauHinhTheoKhoa.get(khoa.id) ?? new Map());
    const soBai = hocPhan.reduce((s, h) => s + h.soBuoi, 0);
    const enrollmentId = ghiDanhTheoCap.get(cap);
    const dongCuaBe: DongDonCuaBe[] = dongDon
      .filter(
        (d) =>
          d.studentId === n.studentId ||
          (enrollmentId !== undefined && d.enrollmentId === enrollmentId) ||
          (!!n.student.leadChildId && docConLeadTuMetadata(d.metadata) === n.student.leadChildId),
      )
      .map((d) => {
        const h = docHinhThucLop(d.metadata);
        return { courseId: h.courseId, soBuoi: h.soBuoi };
      });
    const tongLuot = tongLuotBu({
      hocPhan,
      viTriBatDau: viTriHocPhanBatDau(hocPhan, buoiDau.get(cap)?.ma),
      soBuoiMua: soBuoiMuaCuaBe(dongCuaBe, khoa.id, khoa.totalSessions ?? soBai),
      choPhepHocBu: khoa.choPhepHocBu,
    });
    const dung = daDungTheoCap.get(cap) ?? 0;
    const con = conLuotBu(tongLuot, dung);
    const phi = trangThaiPhi({
      conLuot: con,
      // Buổi bù PHUC_HOC (bảo lưu): coi như đã duyệt miễn phí ⇒ `MIEN_PHI` ⇒ không dùng lượt, không đòi phí (BR-22).
      freeApproved: n.freeApprovedAt !== null || n.nguon === "PHUC_HOC",
      phi: n.feeOrderItemId ? (phiTheoItem.get(n.feeOrderItemId) ?? null) : null,
    });

    const s = buoiTheoId.get(n.missedSessionId);
    const l = s?.lesson;
    const don =
      donPh.find((r) => r.studentId === n.studentId && r.sessionId === n.missedSessionId) ??
      donPh.find((r) => r.studentId === n.studentId && !r.sessionId);

    return {
      id: n.id,
      studentId: n.studentId,
      hocVien: n.student.name,
      lop: n.class.name,
      khoa: khoa.name,
      centerId: n.centerId ?? n.class.centerId,
      courseId: khoa.id,
      lessonId: n.missedLessonId,
      ngayVang: s?.date ?? null,
      // Nhãn buổi qua hàm dùng chung của repo — đừng tự ghép chuỗi (CLAUDE.md, "Don'ts").
      buoiVang: s
        ? deriveSessionLabel({
            lessonOrder: l?.order ?? null,
            lessonTitle: l?.title ?? null,
            moduleCode: l?.moduleCode ?? null,
            topic: s.topic,
          }) || null
        : null,
      luot: { tong: tongLuot, daDung: dung, con },
      phi,
      xep: duocXep(phi),
      donPhuHuynh: don
        ? { dungBuoi: don.sessionId === n.missedSessionId, ngayMongMuon: don.preferredDate }
        : null,
    };
  });
}

// ─── Tab "Đã huỷ" (29/09/2026) — buổi đã huỷ không bù, KHÔI PHỤC được khi phụ huynh đổi ý ──
export type DongDaHuy = {
  id: string;
  centerId: string | null;
  hocVien: string;
  lop: string;
  ngayVang: Date | null;
  buoiVang: string | null;
  lyDo: string | null;
  nguoiHuy: string | null;
  luc: Date | null;
};

export function whereDaHuy(loc: Omit<LocCanBu, "trang" | "soDong">): Prisma.MakeupNeedWhereInput {
  return {
    status: "CANCELLED",
    waivedAt: { not: null },
    createdAt: { gte: HOC_BU_TU_NGAY },
    ...(loc.courseId || loc.classId
      ? { class: { ...(loc.courseId ? { courseId: loc.courseId } : {}), ...(loc.classId ? { id: loc.classId } : {}) } }
      : {}),
    ...(loc.centerId ? { centerId: loc.centerId } : {}),
    ...(loc.chiCuaSale ? { student: hocVienCuaSale(loc.chiCuaSale) } : {}),
    ...(loc.tim ? { AND: [timHocVienBu(loc.tim)] } : {}),
  };
}

export async function docDanhSachDaHuy(
  sdb: Sdb,
  loc: LocCanBu,
): Promise<{ dong: DongDaHuy[]; tong: number; trang: number; soTrang: number }> {
  const where = whereDaHuy(loc);
  const tong = await sdb.makeupNeed.count({ where });
  const soTrang = Math.max(1, Math.ceil(tong / loc.soDong));
  const trang = Math.min(Math.max(1, Math.floor(loc.trang) || 1), soTrang);
  const rows = await sdb.makeupNeed.findMany({
    where,
    orderBy: [{ waivedAt: "desc" }, { id: "asc" }],
    skip: (trang - 1) * loc.soDong,
    take: loc.soDong,
    select: {
      id: true,
      centerId: true,
      missedSessionId: true,
      waivedAt: true,
      waivedById: true,
      waivedReason: true,
      student: { select: { name: true } },
      class: { select: { name: true } },
    },
  });
  const [buoi, nguoi] = await Promise.all([
    sdb.classSession.findMany({
      where: { id: { in: rows.map((r) => r.missedSessionId) } },
      select: { id: true, date: true, topic: true, lesson: { select: { order: true, title: true, moduleCode: true } } },
    }),
    db.user.findMany({
      where: { id: { in: rows.map((r) => r.waivedById).filter((x): x is string => !!x) } },
      select: { id: true, name: true },
    }),
  ]);
  const buoiTheoId = new Map(buoi.map((b) => [b.id, b]));
  const tenTheoId = new Map(nguoi.map((u) => [u.id, u.name]));
  return {
    tong,
    trang,
    soTrang,
    dong: rows.map((r) => {
      const s = buoiTheoId.get(r.missedSessionId);
      return {
        id: r.id,
        centerId: r.centerId,
        hocVien: r.student.name,
        lop: r.class.name,
        ngayVang: s?.date ?? null,
        buoiVang: s
          ? deriveSessionLabel({
              lessonOrder: s.lesson?.order ?? null,
              lessonTitle: s.lesson?.title ?? null,
              moduleCode: s.lesson?.moduleCode ?? null,
              topic: s.topic,
            }) || null
          : null,
        lyDo: r.waivedReason,
        nguoiHuy: r.waivedById ? (tenTheoId.get(r.waivedById) ?? null) : null,
        luc: r.waivedAt,
      };
    }),
  };
}
