import "server-only";
import type { Prisma } from "@prisma/client";
import { soBuoiTheoLoTrinh } from "@/lib/lms/session-order";
import { tinhAnhChup } from "@/lib/bao-luu/anh-chup";

// lib/bao-luu/anh-chup-db.ts — ĐỌC dữ liệu rồi dựng ảnh chụp quyền lợi tại START (BR-14). Chỉ ĐỌC; ghi là việc của người gọi (chung giao dịch
// với chuyển trạng thái START, để ảnh chụp và trạng thái không bao giờ lệch nhau). PHIÊN 6.
type Tx = Prisma.TransactionClient;

/** Cột `snap*` của `StudentReserve` — đưa thẳng vào `patch` của `chuyenTrangThai(START)`. */
export type CotAnhChup = {
  snapTuitionNet: number | null;
  snapSoBuoiMua: number | null;
  snapSoBuoiSuyRa: boolean;
  snapSessionsRemaining: number | null;
  snapUnitPrice: number | null;
  snapStoppedAtLessonOrder: number | null;
  snapPricing: Prisma.InputJsonValue;
};

export async function dungAnhChupKhiBatDau(tx: Tx, hoSo: { enrollmentId: string | null; studentId: string; startedAt: Date }): Promise<CotAnhChup> {
  const trong: CotAnhChup = {
    snapTuitionNet: null, snapSoBuoiMua: null, snapSoBuoiSuyRa: false, snapSessionsRemaining: null, snapUnitPrice: null,
    snapStoppedAtLessonOrder: null, snapPricing: { nguon: "khong-gan-ghi-danh" },
  };
  if (!hoSo.enrollmentId) return trong;

  const gd = await tx.enrollment.findUnique({
    where: { id: hoSo.enrollmentId },
    select: { finalPrice: true, tuition: true, classId: true, course: { select: { totalSessions: true } } },
  });
  if (!gd) return trong;

  // Số buổi MUA: dòng đơn khai `metadata.soBuoi` (mới nhất thắng). Ba đường tạo đơn ngoài form không bao giờ ghi nó ⇒ thường rơi về tổng buổi khoá.
  const dongDon = await tx.orderItem.findMany({
    where: { enrollmentId: hoSo.enrollmentId },
    orderBy: { createdAt: "desc" },
    select: { metadata: true },
    take: 5,
  });
  let soBuoiMua: number | null = null;
  for (const d of dongDon) {
    const m = d.metadata as { soBuoi?: unknown } | null;
    if (m && typeof m.soBuoi === "number" && Number.isInteger(m.soBuoi) && m.soBuoi > 0) {
      soBuoiMua = m.soBuoi;
      break;
    }
  }

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

  const hocPhiThuc = gd.finalPrice ?? gd.tuition ?? null;
  const a = tinhAnhChup({ hocPhiThuc, soBuoiMua, tongBuoiKhoa: gd.course?.totalSessions ?? null, soBuoiDaDung: dau.length });
  return {
    ...a,
    snapStoppedAtLessonOrder: baiDaHoc.length > 0 ? Math.max(...baiDaHoc) : null,
    snapPricing: {
      nguonSoBuoi: soBuoiMua !== null ? "don-hang" : a.snapSoBuoiSuyRa ? "tong-buoi-khoa" : "khong-biet",
      nguonHocPhi: gd.finalPrice != null ? "enrollment.finalPrice" : gd.tuition != null ? "enrollment.tuition" : "khong-biet",
      soBuoiDaDung: dau.length,
      chupLuc: hoSo.startedAt.toISOString(),
    },
  };
}
