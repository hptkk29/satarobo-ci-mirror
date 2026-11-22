// lib/finance/tien-thua.ts — "tiền thừa CHƯA XỬ LÝ" hỏi ở MỘT chỗ.
//
// `CreditBalance` không bao giờ bị xoá hay bù dòng âm: xử lý = đặt `settledAt` (+ người + lý
// do). Kế toán xử lý tay đặt nó; GỠ GẮN giao dịch (`goGanTheoCon`) cũng đặt nó cho phần dư
// của đúng giao dịch ấy, với lý do "do gỡ gắn" (chốt 29/09/2026) — nếu không, gắn lại cùng
// giao dịch là ghi tiền thừa LẦN HAI.
//
// Mọi chỗ ĐỌC tiền thừa chưa xử lý (khối "Tiền thừa chưa xử lý" ở `/bien-dong-so-du`, test
// `[GGL-05*]`) dùng hằng này — đừng viết lại điều kiện tại chỗ.
import type { Prisma } from "@prisma/client";

export const TIEN_THUA_CHUA_XU_LY = { settledAt: null } satisfies Prisma.CreditBalanceWhereInput;

/** Lý do ghi vào `settledReason` khi gỡ gắn. Người đọc thấy ngay dòng này KHÔNG phải được hoàn. */
export function lyDoTienThuaDoGoGan(bankTransactionId: string, lyDoGo: string): string {
  return `Do gỡ gắn giao dịch ${bankTransactionId}: ${lyDoGo}`;
}
