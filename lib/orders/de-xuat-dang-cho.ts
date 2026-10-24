import "server-only";
// lib/orders/de-xuat-dang-cho.ts — ĐƠN NÀY CÓ ĐỀ XUẤT ĐỔI CHƯƠNG TRÌNH GIẢM ĐANG CHỜ DUYỆT KHÔNG. Chỉ ĐỌC.
//
// Nguồn thứ TƯ của cổng chặn mã QR (`lyDoChuaDuyetQr`): đề xuất của Sale thêm/bỏ ưu đãi so với gợi ý, chờ Quản lý cơ sở duyệt (D5).
// Trong lúc chờ, giá của dòng còn có thể đổi ⇒ KHÔNG được phát mã nào thu tiền theo giá hiện tại.
//
// ⚠️ `db` TRẦN, KHÔNG `scopedDb` — đây là phép hỏi để CHẶN: qua `scopedDb` thì đề xuất đúng cái cần chặn có thể bị lọc mất, trả 0, và cổng đọc
// 0 thành "không có gì chờ" ⇒ mở toang đúng lúc phải đóng (cùng bài học `lib/payments/method-lookup.ts`). Cách ly cơ sở đã ép ở cửa vào của từng đường phát mã.
//
// ⚠️ Lỗi truy vấn KHÔNG được nuốt: ném lên ⇒ đường phát mã thất bại, tức đóng. Nuốt lỗi rồi trả `false` là biến một sự cố DB thành "cho phát mã".
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";

type Client = Prisma.TransactionClient | typeof db;

export async function coDeXuatDoiChuongTrinhDangCho(orderId: string, client: Client = db): Promise<boolean> {
  return (await client.discountProgramChangeRequest.count({ where: { orderId, status: "PENDING" } })) > 0;
}
