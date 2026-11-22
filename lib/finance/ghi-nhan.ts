// lib/finance/ghi-nhan.ts — TRỤC B: "hệ thống đã GHI NHẬN bao nhiêu tiền cho đơn này".
//
// ─────────────────────────────────────────────────────────────────────────────
// Hai trục, hai câu hỏi. KHÔNG gộp.
//
//   Trục A — `lib/finance/debt.ts` — "kế toán đã XÁC NHẬN bao nhiêu"
//     lọc `accountantStatus = CONFIRMED` · khoá theo **ghi danh**
//     dùng ở: công nợ · cổng phụ huynh · học phí · báo cáo doanh thu
//
//   Trục B — file này — "hệ thống đã GHI NHẬN bao nhiêu"
//     lọc `saleStatus = RECORDED` · khoá theo **đơn hàng**
//     dùng ở: số tiền in trên mã QR · đối khớp webhook SePay · tin ZNS học phí ·
//             cổng cho phép chốt lead thành ghi danh
//
// CHÊNH LỆCH giữa hai số là thông tin, không phải lỗi: nó chính là "tiền đã về nhưng kế
// toán chưa đối soát". Gộp hai hàm là xoá mất tín hiệu phát hiện webhook hỏng — đó là lý
// do chủ dự án chốt giữ hai đường riêng.
//
// ⚠️ KHOÁ CỦA TRỤC B LÀ ĐƠN HÀNG, KHÔNG PHẢI GHI DANH. `payos-ingest.ts` (tiền về qua
// cổng thanh toán) KHÔNG BAO GIỜ set `enrollmentId`; ép khoá `enrollmentId` ở đây là nuốt
// mất chính những khoản đó. Trục A ngược lại luôn có `enrollmentId` vì `confirmPayment`
// từ chối xác nhận khoản chưa gắn ghi danh.
//
// ─────────────────────────────────────────────────────────────────────────────
// Bút toán ĐIỀU CHỈNH ở trục B
//
// Dòng ADJUSTMENT kế thừa `saleStatus` của phiếu gốc, nên nó ĐƯỢC CỘNG ở đây — và như
// vậy là đúng: `amount` của nó là DELTA. Phiếu 4tr điều chỉnh còn 3tr ⇒ 4tr + (−1tr) = 3tr,
// đúng số tiền thực nhận.
//
// (Trước 07/09/2026 thì sai: dòng điều chỉnh mang SỐ TUYỆT ĐỐI mà vẫn kế thừa
// `saleStatus`, nên trục B cộng cả 4tr lẫn 3tr = 7tr — nhân đôi tiền ngay tại chỗ quyết
// định số in trên mã QR và chỗ đối khớp tiền về.)
// ─────────────────────────────────────────────────────────────────────────────
import type { PaymentSaleStatus } from "@prisma/client";
import { db } from "@/lib/db";

/**
 * Hai trạng thái CÙNG nghĩa "sale đã ghi nhận tiền", theo đúng enum trong schema:
 *
 *   RECORDED          — Sale ghi nhận đã thu
 *   COLLECT_CONFIRMED — Sale xác nhận thực thu (chuẩn bị bàn giao kế toán)
 *
 * ⚠️ VÌ SAO PHẢI LÀ CẢ HAI [vá 14/09/2026]. `COLLECT_CONFIRMED` là bước ĐI SAU
 * `RECORDED` — một lời khẳng định MẠNH HƠN. Nhưng bản trước lọc BẰNG `"RECORDED"`, nên
 * khoản nào tiến lên trạng thái mạnh hơn là **rơi khỏi trục B**. Xác nhận đã thu mà làm
 * tiền BIẾN MẤT khỏi sổ "đã ghi nhận" là ngược đời, và nó tắt lặng lẽ đúng bốn thứ trục
 * B nuôi: số tiền in trên mã QR · đối khớp webhook SePay · tin ZNS học phí · cổng chốt
 * lead thành ghi danh.
 *
 * ĐO ĐƯỢC trên `satarobo_local`: 379/380 khoản mang `COLLECT_CONFIRMED`, 1 khoản
 * `RECORDED` ⇒ trục B đọc ra **1.000.000đ** trong khi trục A là **1.361.044.000đ**. Mọi
 * màn đọc trục B (kể cả ô "Đã thu" trên màn đơn) vì thế sai gần như mọi đơn.
 *
 * Trên PROD hôm nay chưa lộ: `grep COLLECT_CONFIRMED` cho thấy chỉ `prisma/seed-lms/
 * crm.ts:397` và `prisma/seed-uat/04-tai-chinh.ts:102` ghi giá trị đó — không đường chạy
 * thật nào. Nhưng enum có, nhãn UI có ("Đã xác nhận thu",
 * `payments-client.tsx:90`), nên ngày ai đó nối bước chuyển trạng thái ấy là tiền rụng
 * khỏi trục B mà không lỗi nào báo. Vá bây giờ vừa sửa UAT vừa gỡ mìn.
 */
// ⚠️ KHÔNG `as const`: Prisma đòi mảng KHẢ BIẾN cho `in`, mảng `readonly` bị từ chối ở
// tầng kiểu (và lỗi nó in ra dài 8 dòng, rất khó đọc). Kiểu tường minh đã đủ khoá giá trị.
export const SALE_STATUS_DA_GHI_NHAN: PaymentSaleStatus[] = [
  "RECORDED",
  "COLLECT_CONFIRMED",
];

/**
 * Điều kiện `where` cho MỌI truy vấn cộng tiền đã ghi nhận.
 *
 * ⚠️ **CHỜ kế toán thì VẪN TÍNH; kế toán TỪ CHỐI thì KHÔNG.** Hai chuyện khác nhau, và
 * chúng từng bị gộp làm một — đó là nợ `[HT-05]`, vá 24/09/2026.
 *
 * ── Vì sao vế `accountantStatus` phải có ──────────────────────────────────────────────
 * `PaymentSaleStatus` có ĐÚNG HAI giá trị (`RECORDED`, `COLLECT_CONFIRMED`) và
 * `SALE_STATUS_DA_GHI_NHAN` liệt kê CẢ HAI ⇒ vế `saleStatus` là một phép so **luôn đúng**
 * (đo: khớp 416/416 dòng `Payment` trên `satarobo_local`). Còn `rejectPayment`
 * (`lib/finance/payment.ts`) chỉ đổi `accountantStatus` thành `REJECTED`, **không đụng**
 * `saleStatus`. Nên trước bản vá, một khoản kế toán đã TỪ CHỐI vẫn được cộng là "đã thu".
 *
 * ── Vì sao chỉ loại `REJECTED`, không loại `REFUNDED` ─────────────────────────────────
 * `refundPayment` tạo một dòng `amount` ÂM. Cộng nó vào là ĐÚNG — nó tự trừ ra. Loại
 * `REFUNDED` là trừ hai lần.
 *
 * ⚠️ Vẫn KHÔNG đòi `CONFIRMED`: khoản chờ kế toán vẫn là tiền đã về, và đó là điểm khác
 * biệt với trục A (`KHOAN_DA_XAC_NHAN`). Đừng "sửa cho giống".
 */
export const KHOAN_DA_GHI_NHAN = {
  saleStatus: { in: SALE_STATUS_DA_GHI_NHAN },
  accountantStatus: { not: "REJECTED" as const },
  deletedAt: null,
};

/**
 * Bản JS của cùng điều kiện — cho chỗ đã nạp sẵn cả danh sách rồi lọc trong bộ nhớ.
 * Đối xứng với `laKhoanDaXacNhan` của trục A (lib/finance/debt.ts).
 *
 * ⚠️ BẮT BUỘC dùng hàm này thay cho `p.saleStatus === KHOAN_DA_GHI_NHAN.saleStatus`.
 * Từ khi `saleStatus` thành `{ in: [...] }`, phép so đó đem một CHUỖI so với một ĐỐI
 * TƯỢNG ⇒ luôn `false` ⇒ cột "đã ghi nhận" của `/cong-no` im lặng về 0 cho mọi dòng.
 * Không lỗi, không cảnh báo — đúng lớp bug mà cả file này được viết ra để chặn.
 */
export function laKhoanDaGhiNhan(p: {
  saleStatus: string;
  /**
   * BẮT BUỘC từ 24/09/2026 (`[HT-05]`). Cố ý KHÔNG để tuỳ chọn: chỗ gọi nào quên `select`
   * cột này sẽ là **lỗi biên dịch**, chứ không phải âm thầm đếm lại khoản đã bị từ chối —
   * đúng điểm cộng của luật 7 mà `docs/luat-doc-so-va-ket-luan.md` ghi lại.
   */
  accountantStatus: string;
  deletedAt?: Date | null;
}): boolean {
  return (
    (SALE_STATUS_DA_GHI_NHAN as readonly string[]).includes(p.saleStatus) &&
    p.accountantStatus !== "REJECTED" &&
    !p.deletedAt
  );
}

/** Σ tiền đã ghi nhận của MỘT đơn hàng. */
export async function sumRecorded(orderId: string): Promise<number> {
  const r = await db.payment.aggregate({
    where: { orderId, ...KHOAN_DA_GHI_NHAN },
    _sum: { amount: true },
  });
  return r._sum.amount ?? 0;
}
