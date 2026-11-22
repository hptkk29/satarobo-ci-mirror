// lib/cham-cong/don-trong-ngay-db.ts — đọc MỌI đơn còn hiệu lực của (người × ngày) bằng MỘT câu (BA §10:
// engine không đi hỏi từng bảng rời rạc). Gom thành ngữ cảnh ở `don-trong-ngay.ts`.
import type { Prisma, PrismaClient } from "@prisma/client";
import type { WorkRequestKindV } from "@/lib/work-request";
import { loaiNgayNghiTuHieuQua, tyLeNghiBuTuHieuQua, type DonHieuLuc } from "./don-trong-ngay";

/**
 * Trạng thái mà đơn VẪN CÒN tác động bảng công. Một chỗ — mọi đường đọc hiệu lực đơn dùng hằng này.
 * "Đang chờ duyệt huỷ" (đợt 11) VẪN hiệu lực: người ta xin huỷ chưa có nghĩa là đã huỷ.
 */
export const TRANG_THAI_CON_HIEU_LUC = ["APPROVED", "CANCEL_REQUESTED"] as const;

/**
 * Đơn mang dấu `effectVersion ≥ 1` (duyệt từ đợt 2 trở đi). Đơn duyệt TRƯỚC đó giữ nghĩa "căn cứ"
 * như lúc được duyệt — không tự đổi công các kỳ đang mở khi bản này lên.
 */
export async function docDonHieuLucNgay(
  client: Pick<PrismaClient, "workRequest" | "leaveType"> | Prisma.TransactionClient,
  userId: string,
  workDate: Date,
): Promise<DonHieuLuc[]> {
  const rows = await client.workRequest.findMany({
    where: {
      requesterId: userId,
      status: { in: [...TRANG_THAI_CON_HIEU_LUC] },
      effectVersion: { gte: 1 },
      fromDate: { lte: workDate },
      toDate: { gte: workDate },
    },
    select: {
      id: true, kind: true, detail: true, startTime: true, endTime: true, approvedStartTime: true, approvedEndTime: true,
      leaveDurationType: true, leaveTypeId: true, appliedEffect: true,
    },
    orderBy: { createdAt: "asc" },
  });
  // Tỉ lệ lương của loại nghỉ — một câu cho cả ngày, chỉ khi có đơn nghỉ.
  const ltIds = [...new Set(rows.map((r) => r.leaveTypeId).filter((x): x is string => !!x))];
  const lts = ltIds.length ? await client.leaveType.findMany({ where: { id: { in: ltIds } }, select: { id: true, paidRatio: true } }) : [];
  const tiLe = new Map(lts.map((l) => [l.id, l.paidRatio]));
  return rows.map(({ leaveTypeId, appliedEffect, ...r }) => ({
    ...r,
    tyLeNghiBu: r.kind === "OT" || r.kind === "HOLIDAY_WORK" ? tyLeNghiBuTuHieuQua(appliedEffect) : null,
    loaiNgayNghi: r.kind === "HOLIDAY_WORK" ? loaiNgayNghiTuHieuQua(appliedEffect) : null,
    kind: r.kind as WorkRequestKindV,
    leavePaidRatio: leaveTypeId ? (tiLe.get(leaveTypeId) ?? null) : null,
  }));
}
