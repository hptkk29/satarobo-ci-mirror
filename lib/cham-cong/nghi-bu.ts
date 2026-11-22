// lib/cham-cong/nghi-bu.ts — SỔ QUỸ NGHỈ BÙ (đợt 8 đơn từ, BA 4.11). Ledger, không phải một ô số dư:
// mỗi dòng `CompTimeLedger` là một biến động có dấu, số dư = Σ minutes.
//
// Nguồn cộng quỹ (BA 5.1): APPROVED_OT · HOLIDAY_WORK · MANUAL_ADJUSTMENT. Nguồn trừ: COMP_LEAVE (duyệt
// đơn nghỉ bù). Hoàn: COMP_LEAVE_REFUND (huỷ đơn nghỉ bù đã duyệt — đợt 11).
//
// QUỸ KHÔNG BAO GIỜ ÂM — trên MỌI đường ghi, kiểm dưới CÙNG một khoá theo người (`khoaQuyNghiBu`):
//   · dùng quỹ (duyệt nghỉ bù) và điều chỉnh trừ: thiếu ⇒ từ chối;
//   · huỷ đơn OT / làm ngày nghỉ (đợt 11): thiếu ⇒ từ chối huỷ (`hoan-tac.ts`);
//   · TÍNH LẠI CÔNG làm giảm phần đã cộng (vd chỉnh công rút giờ OT) mà phần đó ĐÃ được nghỉ bù: KHÔNG ghi
//     dòng âm (sẽ đẩy quỹ âm), KHÔNG kẹp về 0 (mất dấu nghĩa vụ) — `doiChieuQuyTuCong` trả phần "treo",
//     `recompute` gắn cờ QUY_NGHI_BU_CAN_RA_SOAT lên ngày + ghi audit một lần, màn quỹ liệt kê để quản lý
//     xử lý. Lần tính lại sau (khi quỹ đã đủ) tự trừ nốt — vì ghi theo CHÊNH LỆCH.
//
// ⚠️ CHÍNH SÁCH QUY ĐỔI mặc định AN TOÀN: `shift.otQuyDoi = TRA_TIEN` ⇒ OT KHÔNG tự sinh nghỉ bù (không
// vừa trả tiền vừa cho nghỉ — BA 5.2). Chỉ khi người vận hành đổi sang NGHI_BU thì việc tính lại công
// mới ghi dòng cộng quỹ — theo kiểu CHÊNH LỆCH (mong muốn − đã ghi), nên tính lại bao nhiêu lần cũng
// không cộng trùng, và đơn OT bị huỷ thì lần tính lại sau tự ghi dòng âm trả quỹ về đúng.
import type { Prisma, PrismaClient } from "@prisma/client";

type Client = Pick<PrismaClient, "compTimeLedger"> | Prisma.TransactionClient;

export const NGUON_QUY = {
  OT: "APPROVED_OT",
  LAM_NGAY_NGHI: "HOLIDAY_WORK",
  DIEU_CHINH: "MANUAL_ADJUSTMENT",
  NGHI_BU: "COMP_LEAVE",
  HOAN_NGHI_BU: "COMP_LEAVE_REFUND",
} as const;

export async function soDuNghiBu(client: Client, userId: string): Promise<number> {
  const r = await client.compTimeLedger.aggregate({ where: { userId }, _sum: { minutes: true } });
  return r._sum.minutes ?? 0;
}

/**
 * Khoá tư vấn theo người, TRONG giao dịch: hai lượt duyệt nghỉ bù cùng lúc cho cùng một người không
 * cùng đọc một số dư rồi cùng trừ (quỹ âm). Khoá tự nhả khi giao dịch kết thúc.
 */
export async function khoaQuyNghiBu(tx: Prisma.TransactionClient, userId: string): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`nghi-bu:${userId}`}))`;
}

/** Khoá nguồn cho dòng cộng quỹ do TÍNH LẠI CÔNG sinh ra: một (người × ngày × loại nguồn). */
export const khoaNguonNgay = (userId: string, workDate: Date) => `${userId}:${workDate.toISOString().slice(0, 10)}`;

/**
 * Đưa tổng quỹ của một nguồn-ngày về đúng `mongMuon` bằng MỘT dòng chênh lệch (nếu cần). Gọi từ
 * `recomputeAttendanceDay` khi chính sách quy đổi là NGHI_BU. Trả số phút vừa ghi (0 = đã khớp).
 */
export type KetQuaDoiChieu = {
  /** Phút vừa ghi (dương = cộng, âm = trừ lại). 0 = đã khớp hoặc bị treo. */
  ghi: number;
  /** Phút cần TRỪ mà không trừ được vì quỹ không đủ (đã được dùng) — phải rà soát. */
  treo: number;
  /** Số dư lúc treo (chỉ có khi `treo > 0`). */
  soDu: number | null;
};

/**
 * Đưa tổng quỹ của một nguồn-ngày về đúng `mongMuon` bằng MỘT dòng chênh lệch (nếu cần), TRONG giao dịch
 * `tx`. Chênh âm mà quỹ không đủ ⇒ KHÔNG ghi, trả `treo` (xem đầu file).
 */
export async function doiChieuQuyTuCong(
  tx: Prisma.TransactionClient,
  opts: {
    userId: string;
    centerId: string;
    orgUnitId: string | null;
    workDate: Date;
    sourceType: (typeof NGUON_QUY)["OT"] | (typeof NGUON_QUY)["LAM_NGAY_NGHI"];
    mongMuon: number;
  },
): Promise<KetQuaDoiChieu> {
  const sourceId = khoaNguonNgay(opts.userId, opts.workDate);
  const r = await tx.compTimeLedger.aggregate({
    where: { userId: opts.userId, sourceType: opts.sourceType, sourceId },
    _sum: { minutes: true },
  });
  const chenh = Math.round(opts.mongMuon) - (r._sum.minutes ?? 0);
  if (chenh === 0) return { ghi: 0, treo: 0, soDu: null };
  if (chenh < 0) {
    await khoaQuyNghiBu(tx, opts.userId);
    const soDu = await soDuNghiBu(tx, opts.userId);
    if (soDu + chenh < 0) return { ghi: 0, treo: -chenh, soDu };
  }
  await tx.compTimeLedger.create({
    data: {
      userId: opts.userId,
      centerId: opts.centerId,
      orgUnitId: opts.orgUnitId,
      minutes: chenh,
      sourceType: opts.sourceType,
      sourceId,
      workDate: opts.workDate,
      note: chenh > 0 ? "Cộng quỹ theo công đã tính" : "Điều chỉnh quỹ theo công tính lại",
    },
  });
  return { ghi: chenh, treo: 0, soDu: null };
}
