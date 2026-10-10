import "server-only";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { getSetting } from "@/lib/settings/service";
import { TRANG_THAI_DON_KHONG_NHAN_TIEN } from "@/lib/payments/don-nhan-tien";
import { vnStartOfDay } from "@/lib/time/vn";
import type { ChinhSach, KhoanDenHan } from "@/lib/bao-luu/hoso";
import { TRANG_THAI_DONG } from "@/lib/bao-luu/trang-thai";

// lib/bao-luu/ngu-canh-db.ts — các phép ĐỌC cho luật lập/duyệt bảo lưu. Chỉ đọc, không ghi.
type Client = Prisma.TransactionClient | typeof db;

/**
 * Chính sách bảo lưu hiệu lực cho một cơ sở (cơ sở → toàn hệ → mặc định). `getSetting` có cache theo khoá + cơ sở.
 *
 * ⚠️ `orgUnitId`, KHÔNG `centerId` (xem `lib/bao-luu/feature.ts`).
 */
export async function docChinhSach(orgUnitId: string | null): Promise<ChinhSach> {
  const o = { orgUnitId };
  const [maxMonths, minDays, maxPerEnrollment, medicalProofDays, backdateMaxSessions, maxOverdueDebtDays, extendTimes, extendMaxMonths] =
    await Promise.all([
      getSetting("enrollment.suspendMaxMonths", o),
      getSetting("pause.minDays", o),
      getSetting("pause.maxPerEnrollment", o),
      getSetting("pause.medicalProofDays", o),
      getSetting("pause.backdateMaxSessions", o),
      getSetting("pause.maxOverdueDebtDays", o),
      getSetting("pause.extendTimes", o),
      getSetting("pause.extendMaxMonths", o),
    ]);
  return { maxMonths, minDays, maxPerEnrollment, medicalProofDays, backdateMaxSessions, maxOverdueDebtDays, extendTimes, extendMaxMonths };
}

/**
 * Số lần ĐÃ DÙNG của một ghi danh (BR-08): hồ sơ PARENT/LEGACY ĐÃ TỪNG SANG ACTIVE — tức không ở `PENDING` (chưa
 * bắt đầu), `REJECTED`, `CANCELLED`. `ENDED`/`TERMINATED` có tính: đã từng sang ACTIVE thì tính, kể cả phục học sau
 * một ngày. CENTER không tính (BR-23). Hồ sơ `PENDING` đang chờ không phải "một lần đã dùng" — nó bị chặn riêng bằng
 * `coHoSoMoChoGhiDanh` với câu nói đúng ("đang có hồ sơ"), thay vì đếm sai thành "đã đủ lần".
 */
export async function demLanDaDung(c: Client, enrollmentId: string): Promise<number> {
  return c.studentReserve.count({
    where: { enrollmentId, type: { in: ["PARENT", "LEGACY"] }, status: { notIn: ["PENDING", "REJECTED", "CANCELLED"] } },
  });
}

/**
 * Ghi danh có hồ sơ MỞ nào không — gồm cả hồ sơ chờ duyệt (`PENDING`, chưa nghỉ) và hồ sơ cả-học-viên đang nghỉ. Khác
 * `dangBaoLuu` (chỉ trả lời "đang nghỉ"): lập hồ sơ thứ hai khi đã có hồ sơ chờ duyệt phải bị chặn từ cửa, không đợi
 * chỉ mục duy nhất ném P2002.
 */
export async function coHoSoMoChoGhiDanh(c: Client, p: { enrollmentId: string; studentId: string; now: Date }): Promise<boolean> {
  const mo = await c.studentReserve.count({
    where: {
      OR: [
        { enrollmentId: p.enrollmentId, status: { notIn: [...TRANG_THAI_DONG] } },
        // Hồ sơ cũ "cả học viên" (enrollmentId NULL) còn hiệu lực phủ mọi ghi danh của học viên đó.
        { studentId: p.studentId, enrollmentId: null, isActive: true, endedAt: null, startedAt: { lte: p.now } },
      ],
    },
  });
  return mo > 0;
}

/**
 * Các khoản ĐẾN HẠN còn nợ của một ghi danh — cho BR-06.
 *
 *   · Sổ MỚI `PaymentRequest`: theo dòng hàng nối ghi danh (`orderItem.enrollmentId`), còn thiếu theo phân bổ.
 *   · Sổ CŨ `OrderInstallment`: chỉ mức ĐƠN — tính cho ghi danh khi đơn KHÔNG có dòng nào thuộc học viên khác
 *     (đơn nhiều con thì không suy được khoản nào của bé nào, và chặn nhầm một bé vì nợ của bé kia là sai chiều).
 *
 * Đơn không còn nhận tiền (huỷ / hoàn…) không tính.
 */
export async function docKhoanDenHan(c: Client, p: { enrollmentId: string; studentId: string }): Promise<KhoanDenHan[]> {
  const [moi, cu] = await Promise.all([
    c.paymentRequest.findMany({
      where: {
        status: { in: ["PENDING", "PARTIAL"] },
        dueDate: { not: null },
        orderItem: { enrollmentId: p.enrollmentId },
        order: { deletedAt: null, status: { notIn: [...TRANG_THAI_DON_KHONG_NHAN_TIEN] } },
      },
      select: { dueDate: true, amountDue: true, allocations: { select: { amount: true } } },
    }),
    c.orderInstallment.findMany({
      where: {
        status: "PENDING",
        dueDate: { not: null },
        order: {
          deletedAt: null,
          status: { notIn: [...TRANG_THAI_DON_KHONG_NHAN_TIEN] },
          items: {
            some: { enrollmentId: p.enrollmentId },
            none: { enrollment: { studentId: { not: p.studentId } } },
          },
        },
      },
      select: { dueDate: true, amount: true },
    }),
  ]);
  return [
    ...moi.map((r) => ({ dueDate: r.dueDate!, conNo: r.amountDue - r.allocations.reduce((s, a) => s + a.amount, 0) })),
    ...cu.map((r) => ({ dueDate: r.dueDate!, conNo: r.amount })),
  ];
}

/**
 * Số buổi học (không huỷ) của lớp từ NGÀY NGHỈ ĐẦU TIÊN tới `now` — cho BR-09. Đếm theo mốc 00:00 lịch VN của ngày
 * đó (`ClassSession.date` mang GIỜ THẬT — `@db.Timestamptz`, không phải `@db.Date`).
 */
export async function demBuoiTuNgay(c: Client, p: { classId: string; tuNgay: Date; now: Date }): Promise<number> {
  return c.classSession.count({
    where: {
      classId: p.classId,
      status: { not: "CANCELLED" },
      date: { gte: vnStartOfDay(p.tuNgay), lte: p.now },
    },
  });
}

/**
 * Trong các ghi danh của MỘT học viên, những cái KHÔNG có hồ sơ mở (chờ duyệt / đang bảo lưu / hồ sơ cũ cả-học-viên đang
 * hiệu lực). Màn lập hồ sơ chỉ đưa những ghi danh này vào ô chọn — chọn rồi mới bị từ chối là lời hứa suông (luật 12).
 * Đọc toàn cục (không scope): người gọi ĐÃ chứng minh học viên nằm trong tầm nhìn.
 */
export async function ghiDanhChuaCoHoSoMo(p: { studentId: string; enrollmentIds: readonly string[]; now: Date }): Promise<Set<string>> {
  const co = await Promise.all(p.enrollmentIds.map((id) => coHoSoMoChoGhiDanh(db, { enrollmentId: id, studentId: p.studentId, now: p.now })));
  return new Set(p.enrollmentIds.filter((_, i) => !co[i]));
}

/** Ba tham số riêng của cron/thông báo (cơ sở → toàn hệ → mặc định). Tách khỏi `docChinhSach` vì luật LẬP/DUYỆT không cần chúng. */
export async function docChinhSachCron(
  orgUnitId: string | null,
): Promise<{ remindBeforeDays: number; escalateAfterDays: number; noticeResponseDays: number }> {
  const o = { orgUnitId };
  const [remindBeforeDays, escalateAfterDays, noticeResponseDays] = await Promise.all([
    getSetting("pause.remindBeforeDays", o),
    getSetting("pause.escalateAfterDays", o),
    getSetting("pause.noticeResponseDays", o),
  ]);
  return { remindBeforeDays, escalateAfterDays, noticeResponseDays };
}
