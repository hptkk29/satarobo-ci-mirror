import "server-only";
// lib/finance/tao-qr-session.ts — GHI MỘT `QrSession` MỚI: khoá đơn → KIỂM LẠI cổng duyệt → ghi. Một cổng, ĐÚNG CHỖ GHI.
//
// Vì sao tồn tại [rà soát độc lập 19/10/2026]: `_qr-core.ts` kiểm cổng duyệt (`guardIssuable`) ở ĐẦU hàm, rồi gọi dịch vụ ngoài (`createPaymentLink` của payOS)
// và chỉ SAU ĐÓ mới ghi `QrSession`. Khoảng giữa không giữ khoá đơn, nên một đề xuất đổi chương trình giảm (`guiDeXuat`, giữ khoá đơn, đếm `QrSession` ACTIVE = 0,
// commit PENDING) chen vào được; rồi QR được ghi ⇒ đơn có đề xuất chờ DUYỆT mà vẫn có mã còn hạn theo giá cũ — đúng điều bất biến cấm.
// Nay lượt GHI giữ cùng khoá đơn với `guiDeXuat`, đọc LẠI ba cột duyệt + bảng đề xuất rồi mới ghi: hai bên xếp hàng, bên đến sau thấy kết quả của bên trước
// (đề xuất đến trước ⇒ QR bị chặn; QR đến trước ⇒ đề xuất bị từ chối `DON_DA_PHAT_MA`).
//
// Link thanh toán đã tạo ở payOS khi bị chặn ở đây chỉ là một link mồ côi không có `QrSession` trỏ vào — vô hại (không ai đưa nó cho khách).
// Từ chối là `return` TRƯỚC phép ghi đầu tiên của callback (luật rollback).
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { laDonChoDuyet, lyDoChuaDuyetQr } from "@/lib/orders/cho-duyet";
import { coDeXuatDoiChuongTrinhDangCho } from "@/lib/orders/de-xuat-dang-cho";
import { khoaDonTrongTx } from "./ghi-tien-don";

export type KetQuaTaoQrSession = { readonly ok: true; readonly id: string } | { readonly ok: false; readonly error: string };

export async function taoQrSessionDuoiKhoa(vao: { readonly orderId: string; readonly data: Prisma.QrSessionUncheckedCreateInput }): Promise<KetQuaTaoQrSession> {
  return db.$transaction(async (tx): Promise<KetQuaTaoQrSession> => {
    await khoaDonTrongTx(tx, vao.orderId);
    const don = await tx.order.findUnique({
      where: { id: vao.orderId },
      select: { discountApprovalStatus: true, installmentApprovalStatus: true, soBuoiApprovalStatus: true },
    });
    if (!don) return { ok: false, error: "Không tìm thấy đơn hàng" };
    const lyDo = lyDoChuaDuyetQr(laDonChoDuyet(don), await coDeXuatDoiChuongTrinhDangCho(vao.orderId, tx));
    if (lyDo) return { ok: false, error: lyDo };
    const row = await tx.qrSession.create({ data: vao.data, select: { id: true } });
    return { ok: true, id: row.id };
  });
}
