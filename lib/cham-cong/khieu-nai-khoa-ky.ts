// lib/cham-cong/khieu-nai-khoa-ky.ts — phần DÙNG CHUNG giữa `lockPeriod` (period.ts) và khiếu nại công
// (xac-nhan-cong.ts). Tách riêng để hai file kia không import vòng nhau.
import type { Prisma } from "@prisma/client";
import { getSetting } from "@/lib/settings/service";
import { KHIEU_NAI_DANG_MO } from "./xac-nhan-cong-thuan";

/** Công tắc P2.2 (`shift.xacNhanCongBat`, mặc định TẮT). Tắt ⇒ không ô xác nhận, không cổng khoá kỳ. */
export const xacNhanCongDangBat = () => getSetting("shift.xacNhanCongBat");

/**
 * Khoá tư vấn của MỘT kỳ công. `lockPeriod` (trong giao dịch khoá) và mọi đường MỞ khiếu nại (mở mới,
 * khiếu nại tiếp) cùng lấy ⇒ một khiếu nại không thể lọt vào giữa lúc kỳ đang được khoá.
 */
export async function khoaKyCong(tx: Prisma.TransactionClient, centerId: string, periodKey: string): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`ky-cong:${centerId}:${periodKey}`}))`;
}

/**
 * Người thuộc kỳ công của cơ sở: có ca ACTIVE hoặc lượt quét ACCEPTED ở cơ sở trong kỳ. `lockPeriod` tính
 * lại đúng tập này trước khi khoá, và báo cáo "ai chưa xác nhận" đọc đúng tập này — hai tập khác nhau là
 * hai con số cãi nhau.
 */
export async function nguoiTrongKy(
  client: Pick<Prisma.TransactionClient, "shiftAssignment" | "staffTimeLog">,
  centerId: string,
  from: Date,
  to: Date,
): Promise<string[]> {
  const [ca, quet] = await Promise.all([
    client.shiftAssignment.findMany({
      where: { centerId, workDate: { gte: from, lte: to }, status: "ACTIVE" },
      select: { userId: true },
      distinct: ["userId"],
    }),
    client.staffTimeLog.findMany({
      where: { centerId, workDate: { gte: from, lte: to }, result: "ACCEPTED" },
      select: { userId: true },
      distinct: ["userId"],
    }),
  ]);
  return [...new Set([...ca, ...quet].map((x) => x.userId))];
}

/** Số khiếu nại NGHIÊM TRỌNG còn chưa kết luận của kỳ — MỌI trạng thái chưa kết luận đều chặn khoá. */
export async function demKhieuNaiChanKhoa(
  // Kiểu cấu trúc tối thiểu: nhận cả `db`, `tx` lẫn `scopedDb(actor)` (màn kỳ công đọc qua scopedDb).
  client: { attendanceDispute: { count: (args: Prisma.AttendanceDisputeCountArgs) => PromiseLike<number> } },
  centerId: string,
  periodKey: string,
): Promise<number> {
  return client.attendanceDispute.count({
    where: { centerId, periodKey, critical: true, status: { in: [...KHIEU_NAI_DANG_MO] } },
  });
}
