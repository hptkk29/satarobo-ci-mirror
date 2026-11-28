import "server-only";
import type { Prisma } from "@prisma/client";
import { soBuoiTheoLoTrinh } from "@/lib/lms/session-order";
import { tinhAnhChup } from "@/lib/bao-luu/anh-chup";
import { chonDongDonChoGhiDanh, type DongDonUngVien } from "@/lib/bao-luu/dong-don-cua-ghi-danh";
import { locDonNhanTien } from "@/lib/payments/don-nhan-tien";

// lib/bao-luu/anh-chup-db.ts — ĐỌC dữ liệu rồi dựng ảnh chụp quyền lợi tại START (BR-14). Chỉ ĐỌC; ghi là việc của người gọi (chung giao dịch
// với chuyển trạng thái START, để ảnh chụp và trạng thái không bao giờ lệch nhau). PHIÊN 6.
type Tx = Prisma.TransactionClient;

/** Cột `snap*` của `StudentReserve` — đưa thẳng vào `patch` của `chuyenTrangThai(START)`. */
export type CotAnhChup = {
  snapTuitionNet: number | null;
  snapSoBuoiMua: number | null;
  snapSoBuoiSuyRa: boolean;
  snapTuitionSuyRa: boolean;
  snapSessionsRemaining: number | null;
  snapUnitPrice: number | null;
  snapStoppedAtLessonOrder: number | null;
  snapPricing: Prisma.InputJsonValue;
};

export async function dungAnhChupKhiBatDau(tx: Tx, hoSo: { enrollmentId: string | null; studentId: string; startedAt: Date }): Promise<CotAnhChup> {
  const trong: CotAnhChup = {
    snapTuitionNet: null, snapSoBuoiMua: null, snapSoBuoiSuyRa: false, snapTuitionSuyRa: false, snapSessionsRemaining: null, snapUnitPrice: null,
    snapStoppedAtLessonOrder: null, snapPricing: { nguon: "khong-gan-ghi-danh" },
  };
  if (!hoSo.enrollmentId) return trong;

  const gd = await tx.enrollment.findUnique({
    where: { id: hoSo.enrollmentId },
    select: { id: true, studentId: true, courseId: true, leadChildId: true, finalPrice: true, tuition: true, classId: true, course: { select: { totalSessions: true } } },
  });
  if (!gd) return trong;

  // DÒNG ĐƠN của ghi danh (C13, chốt 13): học phí = `totalPrice − discountAmount` VÀ số buổi mua `metadata.soBuoi` lấy từ CÙNG MỘT dòng — hai nửa của một phép chia
  // không được đến từ hai nguồn. Chọn dòng ở `chonDongDonChoGhiDanh` (thuần, có test): nối trực tiếp `enrollmentId`, rồi qua `metadata`; mơ hồ ⇒ không đoán.
  // Đơn không còn nhận tiền (huỷ/hoàn/nháp) không tính: giá của một đơn đã huỷ không phải học phí ai đang nợ.
  const donNhan = locDonNhanTien();
  const select = { enrollmentId: true, totalPrice: true, discountAmount: true, metadata: true } as const;
  const [truc, quaMetadata] = await Promise.all([
    tx.orderItem.findMany({ where: { enrollmentId: gd.id, order: donNhan }, select, take: 10 }),
    tx.orderItem.findMany({
      where: {
        enrollmentId: null,
        type: "COURSE_ENROLLMENT",
        AND: [{ order: donNhan }, { OR: [{ studentId: gd.studentId }, { studentId: null, order: { studentId: gd.studentId } }] }],
      },
      select,
      take: 50,
    }),
  ]);
  const ungVien: DongDonUngVien[] = [...truc, ...quaMetadata];
  const dong = chonDongDonChoGhiDanh({ id: gd.id, courseId: gd.courseId, leadChildId: gd.leadChildId }, ungVien);
  const soBuoiMua: number | null = dong?.soBuoi ?? null;

  // Buổi ĐÃ DÙNG: có mặt / đi muộn / đã học bù, trong lớp của ghi danh, đến thời điểm bắt đầu. Vắng (có phép lẫn không phép) KHÔNG phải đã dùng.
  const dau = await tx.attendance.findMany({
    where: {
      studentId: hoSo.studentId,
      session: { classId: gd.classId, status: { not: "CANCELLED" }, date: { lte: hoSo.startedAt } },
      OR: [{ status: { in: ["PRESENT", "LATE"] } }, { makeupStatus: "MADE_UP" }],
    },
    select: { session: { select: { plan: { select: { order: true } }, lesson: { select: { order: true } } } } },
  });
  const baiDaHoc = dau
    .map((a) => soBuoiTheoLoTrinh({ planOrder: a.session.plan?.order ?? null, lessonOrder: a.session.lesson?.order ?? null }))
    .filter((n): n is number => n !== null);

  // Không tìm được dòng đơn ⇒ dùng học phí GHI DANH (`finalPrice ?? tuition`) và đặt cờ `snapTuitionSuyRa`; không có cả hai ⇒ NULL (không bao giờ 0).
  const hocPhiThuc = dong ? dong.hocPhiRong : (gd.finalPrice ?? gd.tuition ?? null);
  const a = tinhAnhChup({ hocPhiThuc, hocPhiSuyRa: !dong, soBuoiMua, tongBuoiKhoa: gd.course?.totalSessions ?? null, soBuoiDaDung: dau.length });
  return {
    ...a,
    snapStoppedAtLessonOrder: baiDaHoc.length > 0 ? Math.max(...baiDaHoc) : null,
    snapPricing: {
      nguonSoBuoi: soBuoiMua !== null ? "don-hang" : a.snapSoBuoiSuyRa ? "tong-buoi-khoa" : "khong-biet",
      nguonHocPhi: dong ? dong.nguon : gd.finalPrice != null ? "enrollment.finalPrice" : gd.tuition != null ? "enrollment.tuition" : "khong-biet",
      // Để Kế toán đối chiếu khi hai nguồn lệch (đo prod 11/10: 6/10 ghi danh so được là lệch): số ghi danh ĐANG ghi lúc chụp, kể cả khi không dùng làm tử số.
      hocPhiGhiDanhLucChup: gd.finalPrice ?? gd.tuition ?? null,
      soBuoiDaDung: dau.length,
      chupLuc: hoSo.startedAt.toISOString(),
    },
  };
}
