import "server-only";
// lib/payments/pos/dong-the-chua-ket-luan-gan.ts — PHÍA MÀN của `maCoDongTheChuaKetLuan`: gắn `coDongTheChuaKetLuan` vào các phiếu
// thẻ đọc từ DB (màn đơn). Đầu vào của nó là hàng THÔ (không cần kết quả của `ganChoTay`) nên hai câu tra `posCardTransaction` của màn chạy SONG SONG
// (`ganCoPhiaMan` ở `phieu-pos.ts`) — trước đây nối đuôi nhau, thêm một lượt đi-về DB vào trang đơn.
//
// CÙNG mốc `mocChoTay` mà `ganChoTay` / cổng máy chủ (`huy-phieu-the-db.ts`) dùng — tính trên MỌI phiếu thẻ của một phiếu gộp (xem
// "CẠM BẪY mốc" ở đầu `huy-phieu-the-db.ts`) — qua CÙNG hàm gom `cuaSoTheoPhieuGop` với `ganChoTay`. Một câu tra cho cả danh sách.
import type { Prisma } from "@prisma/client";
import { maCoDongTheChuaKetLuan } from "./dong-the-chua-ket-luan";
import { cuaSoTheoPhieuGop } from "./the-dang-mo";

export async function ganDongTheChuaKetLuan<
  T extends { code5: string; createdAt: Date; paymentBillId: string; paymentBill: { createdAt: Date } },
>(client: Pick<Prisma.TransactionClient, "posCardTransaction">, ds: readonly T[]): Promise<(T & { coDongTheChuaKetLuan: boolean })[]> {
  const co = await maCoDongTheChuaKetLuan(client, cuaSoTheoPhieuGop(ds));
  return ds.map((p) => ({ ...p, coDongTheChuaKetLuan: co.has(p.code5) }));
}
