// lib/finance/hai-truc-theo-don.ts — HAI TRỤC cho MỘT TẬP ĐƠN, trong MỘT lượt tra.
//
// ─────────────────────────────────────────────────────────────────────────────
// VÌ SAO CẦN — VÀ VÌ SAO KHÔNG DÙNG LẠI ĐƯỢC HÀM NÀO ĐANG CÓ
//
// Chủ dự án chốt 16/09: trạng thái đơn suy từ TIỀN, hiển thị HAI TRỤC. Trang chi tiết
// `/orders/[id]` đã có sẵn bộ số (nó gọi `congNoDon` cho MỘT đơn). Trang DANH SÁCH thì
// chưa: `queryOrders` không nạp `Payment` nào.
//
// Đã tìm hết trước khi viết mới (repo này đã có ≥7 định nghĩa "đã thu", thêm cái nữa là 8):
//   · `getDebtRows` (`debt.ts`)      — CÓ cả hai trục, nhưng khoá là GHI DANH, không phải ĐƠN;
//   · `sumRecorded` (`ghi-nhan.ts`)  — đúng khoá ĐƠN nhưng chỉ TRỤC B, và MỘT đơn mỗi lượt
//                                      ⇒ dùng cho danh sách là N+1 truy vấn;
//   · `congNoDon` (`cong-no-don.ts`) — THUẦN, chỉ làm số học; nó chính là thứ nhận đầu ra
//                                      của file này.
// Nên file này KHÔNG định nghĩa lại "đã thu". Nó chỉ CỘNG, và cộng bằng đúng hai vị từ
// chuẩn đã có: `laKhoanDaGhiNhan` (trục B) và `laKhoanDaXacNhan` (trục A). Đổi luật thì
// đổi ở hai tệp đó, không đổi ở đây.
//
// ─────────────────────────────────────────────────────────────────────────────
// ⚠️ BÚT TOÁN ĐIỀU CHỈNH: CỘNG HẾT, KHÔNG LOẠI DÒNG GỐC
//
// Dòng `ADJUSTMENT` mang **DELTA** (`payment.ts:899-912` — `amount: delta`, âm khi giảm),
// kế thừa `saleStatus` của phiếu gốc và mang trạng thái kế toán ĐÃ XÁC NHẬN. Vậy cách
// cộng đúng là cộng CẢ dòng gốc LẪN dòng delta: 4tr + (−1tr) = 3tr.
//
// Tôi đã tự mắc lỗi ngược lại trong chính phiên này: câu SQL đo tay loại dòng gốc bằng
// `NOT EXISTS (… adjustmentOfId = p.id …)`, tức giữ delta mà bỏ gốc ⇒ ra −1tr. Trên
// `satarobo_local` chưa lộ (đo: **0 dòng** có `adjustmentOfId`, 0 dòng `paymentType =
// ADJUSTMENT`, nên hai cách ra cùng 1.400.301.000đ), nhưng luật thì sai sẵn. Ghi lại để
// không ai chép lại câu SQL đó.
//
// Enum `PaymentAccountantStatus` cũng đã cố ý BỎ `ADJUSTED` (07/09/2026) đúng vì lý do
// này — xem chú thích trong `prisma/schema.prisma`.
//
// ─────────────────────────────────────────────────────────────────────────────
// ⚠️ NỢ ĐÃ ĐO, CHƯA VÁ: TRỤC B ĐẾM CẢ KHOẢN KẾ TOÁN ĐÃ TỪ CHỐI
//
// `PaymentSaleStatus` có ĐÚNG HAI giá trị (`RECORDED`, `COLLECT_CONFIRMED`) và
// `SALE_STATUS_DA_GHI_NHAN` liệt kê CẢ HAI ⇒ vế `saleStatus` của trục B là một phép so
// luôn đúng (đo: khớp 416/416 dòng `Payment` trên satarobo_local). Và `rejectPayment`
// (`payment.ts:719`) chỉ đổi `accountantStatus` thành `REJECTED`, KHÔNG đụng `saleStatus`
// ⇒ khoản kế toán đã TỪ CHỐI vẫn được đếm là "đã thu".
//
// Hôm nay chưa thiệt hại: 0 dòng `REJECTED`/`REFUNDED` trên satarobo_local. Nhưng đường
// ghi còn sống, nên theo luật đọc số thì 0 dòng KHÔNG hạ được mức nghiêm trọng.
//
// KHÔNG tự vá ở đây, và đó là quyết định có chủ đích: trục B nuôi BỐN đường tiền khác
// (số in trên mã QR · ngưỡng đối khớp SePay · tin ZNS học phí · cổng chốt lead thành ghi
// danh — xem đầu `lib/finance/ghi-nhan.ts`). Siết nó là đổi cả bốn, phải là đợt riêng có
// chủ dự án duyệt. Ghim ở `lib/finance/hai-truc-theo-don.test.ts` ca `[HT-05]` bằng
// `it.fails`.
//
// ⚠️ Hoàn tiền thì NGƯỢC LẠI — KHÔNG phải lỗi: `refundPayment` tạo dòng `amount` ÂM
// (`payment.ts:1075`), nên trục B cộng nó vào là ĐÚNG, nó tự trừ ra.
import { laKhoanDaXacNhan } from "@/lib/finance/debt";
import { laKhoanDaGhiNhan } from "@/lib/finance/ghi-nhan";

/** Hai con số của MỘT đơn. Đưa thẳng vào `congNoDon`. */
export type HaiTrucCuaDon = {
  /** TRỤC B — hệ thống đã ghi nhận. */
  daGhiNhan: number;
  /** TRỤC A — kế toán đã xác nhận. */
  daXacNhan: number;
};

/** Đủ để cộng — cố ý hẹp, đừng đòi cả bản ghi `Payment`. */
export type KhoanDeCong = {
  orderId: string | null;
  amount: number;
  saleStatus: string;
  accountantStatus: string;
  deletedAt?: Date | null;
};

export const KHONG_CO_TIEN: HaiTrucCuaDon = { daGhiNhan: 0, daXacNhan: 0 };

/**
 * Gộp danh sách khoản thành hai trục, khoá theo ĐƠN. THUẦN — tách khỏi lượt tra DB để
 * test được mà không cần database.
 *
 * ⚠️ Khoản không có `orderId` bị BỎ QUA (không ném): tiền về qua cổng thanh toán có thể
 * chưa gắn đơn, và đó là trạng thái hợp lệ chứ không phải dữ liệu hỏng.
 */
export function gopHaiTruc(
  khoan: readonly KhoanDeCong[],
): Map<string, HaiTrucCuaDon> {
  const m = new Map<string, HaiTrucCuaDon>();
  for (const k of khoan) {
    if (!k.orderId) continue;
    const cur = m.get(k.orderId) ?? { daGhiNhan: 0, daXacNhan: 0 };
    if (laKhoanDaGhiNhan(k)) cur.daGhiNhan += k.amount;
    if (laKhoanDaXacNhan(k)) cur.daXacNhan += k.amount;
    m.set(k.orderId, cur);
  }
  return m;
}

/** Hình dạng tối thiểu của client Prisma mà hàm dưới cần — để test tiêm được bản giả. */
export type DbDocKhoan = {
  payment: {
    findMany: (args: {
      where: { orderId: { in: string[] }; deletedAt: null };
      select: {
        orderId: true;
        amount: true;
        saleStatus: true;
        accountantStatus: true;
      };
    }) => Promise<KhoanDeCong[]>;
  };
};

/**
 * Hai trục cho một TẬP đơn — ĐÚNG MỘT lượt tra, không N+1.
 *
 * ⚠️ TRUYỀN `scopedDb(actor)` VÀO, đừng truyền `db` trần. `Payment` ∈ `SCOPED_MODELS` nên
 * `findMany` tự lọc theo tầm nhìn cơ sở của người đang xem. Truyền `db` trần là người cấp
 * cơ sở cộng được cả tiền của cơ sở khác vào ô "đã thu" của một đơn họ không được xem.
 *
 * Tập rỗng ⇒ trả Map rỗng và KHÔNG tra gì (Prisma `in: []` vẫn là một vòng đi–về).
 */
export async function haiTrucTheoDon(
  sdb: DbDocKhoan,
  orderIds: readonly string[],
): Promise<Map<string, HaiTrucCuaDon>> {
  const ids = [...new Set(orderIds.filter((v) => !!v))];
  if (ids.length === 0) return new Map();
  const khoan = await sdb.payment.findMany({
    where: { orderId: { in: ids }, deletedAt: null },
    select: {
      orderId: true,
      amount: true,
      saleStatus: true,
      accountantStatus: true,
    },
  });
  return gopHaiTruc(khoan);
}
