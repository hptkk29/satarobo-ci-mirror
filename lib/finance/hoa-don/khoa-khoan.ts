// lib/finance/hoa-don/khoa-khoan.ts — CỔNG DÙNG CHUNG "khoản này đã nằm trong hoá đơn chưa"
// (docs/ke-toan-hoa-don/PLAN.md §5).
//
// MỘT cổng, LUÔN CHẠY, KHÔNG hỏi cờ `billing.hoaDonEnabled`: tắt cờ mà mở lại được `rejectPayment`
// trên khoản đã xuất hoá đơn là để tờ hoá đơn trong tay khách nói một số tiền mà sổ đã gỡ.
//
// ⚠️ Tra KHÔNG-SCOPE — tham số là `tx` của transaction đường ghi (client trần), KHÔNG phải
// `scopedDb`. Bài học `lib/payments/method-lookup.ts`: tra qua scope thì đúng dòng cần chặn bị lọc
// mất, trả rỗng, và cổng đọc rỗng thành "không khoá, cho qua" — mở toang đúng lúc phải đóng.
// ⚠️ "Đã khoá" = có dòng `HoaDonKhoan.hieuLuc = true`. Bản bị THAY đã hạ `hieuLuc` ⇒ không giữ;
// gỡ nháp / gỡ không xuất XOÁ dòng nối ⇒ không giữ. Lọc thêm trạng thái hoá đơn cho chắc.

import type { Prisma } from "@prisma/client";

type DocKhoa = Pick<Prisma.TransactionClient, "hoaDonKhoan">;

// Bước 1 MISA (30/09): bản ĐANG PHÁT HÀNH / LỖI PHÁT HÀNH cũng giữ khoản — MISA có thể đã nhận (hoặc sắp nhận
// lại cùng refId); từ chối / tách khoản lúc này là để tờ hoá đơn MISA vừa ký nói một số mà sổ đã gỡ.
export const TRANG_THAI_GIU_KHOAN = ["NHAP", "DA_XAC_NHAN", "KHONG_XUAT", "DANG_PHAT_HANH", "LOI_PHAT_HANH"] as const;

export type KhoanDaKhoa = {
  paymentId: string;
  hoaDonId: string;
  trangThai: (typeof TRANG_THAI_GIU_KHOAN)[number];
  kyHieu: string | null;
  soHoaDon: string | null;
};

/** Điều kiện `where` cho đường ghi chỉ cần BỎ QUA khoản đang khoá (không chặn cả lượt). */
export const KHOAN_CHUA_KHOA_HOA_DON = {
  hoaDonKhoan: { none: { hieuLuc: true } },
} satisfies Prisma.PaymentWhereInput;

export async function khoanDaKhoaHoaDon(tx: DocKhoa, paymentIds: readonly string[]): Promise<KhoanDaKhoa[]> {
  if (paymentIds.length === 0) return [];
  const dong = await tx.hoaDonKhoan.findMany({
    where: {
      paymentId: { in: [...paymentIds] },
      hieuLuc: true,
      hoaDon: { trangThai: { in: [...TRANG_THAI_GIU_KHOAN] } },
    },
    select: { paymentId: true, hoaDon: { select: { id: true, trangThai: true, kyHieu: true, soHoaDon: true } } },
  });
  return dong.map((d) => ({
    paymentId: d.paymentId,
    hoaDonId: d.hoaDon.id,
    trangThai: d.hoaDon.trangThai as KhoanDaKhoa["trangThai"],
    kyHieu: d.hoaDon.kyHieu,
    soHoaDon: d.hoaDon.soHoaDon,
  }));
}

/**
 * Câu từ chối cho người dùng — nói ĐÚNG hoá đơn nào đang giữ khoản và PHẢI LÀM GÌ trước (luật 12:
 * nút bị từ chối mà không nói vì sao là lời hứa suông). THUẦN.
 */
export function thongDiepKhoaHoaDon(khoa: readonly KhoanDaKhoa[]): string {
  const k = khoa[0];
  if (!k) return "";
  const so = [k.kyHieu, k.soHoaDon].filter(Boolean).join("-");
  switch (k.trangThai) {
    case "DA_XAC_NHAN":
      // GĐ 8: KHÔNG có thao tác "thay" (quyết định (1) 27/09) — nói "thay" là hứa một nút không tồn tại.
      return `Khoản đã có hoá đơn ${so || "đã xác nhận"} — kế toán phải huỷ hoá đơn đó ở màn Hoá đơn điện tử trước.`;
    case "NHAP":
      return `Khoản đang gắn với hoá đơn nháp${so ? ` ${so}` : ""} — gỡ bản nháp ở màn Hoá đơn điện tử trước.`;
    case "DANG_PHAT_HANH":
      return `Khoản đang được phát hành hoá đơn qua MISA${so ? ` (${so})` : ""} — chờ MISA xác nhận xong ở màn Hoá đơn điện tử trước.`;
    case "LOI_PHAT_HANH":
      return "Khoản đang giữ trong một lượt phát hành MISA bị lỗi — ở màn Hoá đơn điện tử chọn \"Phát hành lại\" hoặc \"Bỏ, làm tay\" trước.";
    default:
      return "Khoản đã được đánh dấu không xuất hoá đơn — gỡ dấu ở màn Hoá đơn điện tử trước.";
  }
}
