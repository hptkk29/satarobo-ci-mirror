/**
 * Fixture dùng chung cho các spec phân loại NEW/RENEWAL (luật v4, 2026-10-17): GIỜ MÁY CHỦ GHI KHOẢN THU.
 *
 * Vì sao có: bộ phân loại nay xếp tiền lệ đã thu rồi huỷ / hoàn bằng HAI cách đọc ngày thu — ngày người ghi khai (`Payment.paidDate`) và giờ máy chủ ghi khoản (`Payment.createdAt`) — và GIỮ khoản khi
 * hai cách ra hai loại khác nhau. Fixture ghi khoản bằng ĐỒNG HỒ THẬT nên `createdAt` luôn là «bây giờ», trong khi `paidDate` là ngày tuyệt đối (luật 19): ca nào so mốc huỷ / hoàn tuyệt đối với
 * `createdAt` thật sẽ xanh hôm nay và ĐỎ khi lịch trôi qua mốc ấy (đo: huỷ 20/10/2026 xanh trước ngày đó, đỏ sau). Dữ liệu trung thực = ngày khai ≈ ngày ghi, nên fixture phải GHIM
 * `createdAt = paidDate` ngay sau khi ghi (TRƯỚC mọi lượt quét — ca quét giữa chừng phải thấy dữ liệu đã trung thực).
 *
 * Ca muốn dựng dữ liệu KHÔNG trung thực (ngày khai ≠ giờ ghi) thì gọi `ghimGioGhi(paymentId, luc)` với `luc` tuyệt đối.
 */
import { db } from "../../lib/db";

import { hoanTien, tienVe, type Be, type KichBan } from "./_kich-ban";

/** Đặt giờ máy chủ ghi khoản (`Payment.createdAt`) về một thời điểm tuyệt đối. */
export async function ghimGioGhi(paymentId: string, luc: Date): Promise<void> {
  await db.payment.update({ where: { id: paymentId }, data: { createdAt: luc } });
}

/** `tienVe` + ghim giờ ghi = ngày khai (dữ liệu trung thực). */
export async function tienVeTrungThuc(k: KichBan, be: Be, p: Parameters<typeof tienVe>[2]): Promise<string> {
  const id = await tienVe(k, be, p);
  await ghimGioGhi(id, p.ngay);
  return id;
}

/** `hoanTien` + ghim giờ ghi khoản hoàn = ngày khai hoàn (dữ liệu trung thực). */
export async function hoanTienTrungThuc(k: KichBan, paymentId: string, p: Parameters<typeof hoanTien>[2]): Promise<string> {
  const id = await hoanTien(k, paymentId, p);
  await ghimGioGhi(id, p.ngay);
  return id;
}
