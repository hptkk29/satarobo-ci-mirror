// lib/hoa-hong/but-toan.ts — PHÂN LOẠI bút toán `Payment` và MỐC của nó cho engine hoa hồng mới.
//
// Nguồn: docs/source-commission/04 §1 (`mocCuaButToan`), §4.1 (`loaiButToan`). THUẦN — dữ liệu đã nạp.
//
// `mocCuaButToan` là bản THUẦN tách từ `mapButToanHoaHong` (`lib/crm/commission-run.ts`) với CÙNG ba quy tắc — cơ sở
// (Payment → đơn → lead), `rateDate` (ngày GỐC với khoản hoàn), `assigneeDate` (`confirmedAt` của GỐC nếu có gốc) — để engine
// cũ và mới trả lời giống nhau. Không import ngược engine cũ (nó kéo `@/lib/db`); lưới `[NHH-BT-W1]` ghim hai bản không lệch.
import { kyCuaButToan } from "@/lib/crm/commission-thuc-thu";

export type HangButToan = {
  id: string;
  /** Có dấu: hoàn / điều chỉnh giảm = âm. */
  amount: number;
  method: string;
  note: string | null;
  paidDate: Date;
  confirmedAt: Date | null;
  accountantStatus: string;
  paymentType: string;
  adjustmentOfId: string | null;
  orderId: string;
  orderItemId: string | null;
  enrollmentId: string | null;
  centerId: string | null;
  /** Gốc của bút toán điều chỉnh / hoàn (nạp kèm); `null` nếu không có. */
  adjustmentOf: { id: string; paidDate: Date; confirmedAt: Date | null; centerId: string | null } | null;
  order: { centerId: string | null; lead: { centerId: string | null } | null } | null;
};

export type LoaiButToan = "THU" | "DAO_CO_GOC" | "CHUYEN_NOI_BO" | "AM_KHONG_GOC";

/** Marker của `lib/finance/ghi-tien-don.ts` (`markerChuyen`): `[chuyen:<id>]`. */
const MARKER_CHUYEN = /\[chuyen:[^\]\s]+\]/;
const METHOD_CHUYEN = "chuyen-noi-bo";

/**
 * 04 §4.1. Cặp chuyển tiền giữa hai bé phục vụ BA việc khác nhau (sửa gắn nhầm, dư sau dừng học, đổi khoá) nên engine KHÔNG
 * tự quyết: cả hai vế vào hàng chờ cứng. Nhận diện cần CẢ method lẫn marker — chỉ method thì một khoản "chuyen-noi-bo"
 * nhập tay thiếu marker bị coi là chuyển (và ngược lại thì khoản chuyển mất marker bị coi là hoàn).
 */
export function loaiButToan(r: Pick<HangButToan, "amount" | "adjustmentOfId" | "method" | "note">): LoaiButToan {
  if (!Number.isFinite(r.amount) || r.amount === 0) throw new Error(`Bút toán số tiền không hợp lệ: ${r.amount}`);
  if (r.method === METHOD_CHUYEN && r.note !== null && MARKER_CHUYEN.test(r.note)) return "CHUYEN_NOI_BO";
  if (r.amount > 0) return "THU";
  return r.adjustmentOfId !== null ? "DAO_CO_GOC" : "AM_KHONG_GOC";
}

export type MocButToan = {
  centerId: string | null;
  /** Ngày bút toán VÀO SỔ — quyết kỳ tự nhiên. Khoản hoàn mang ngày HOÀN. */
  paidDate: Date;
  /** Ngày dùng để chọn chính sách/VAT: ngày GỐC với khoản hoàn (đòi lại đúng tỉ lệ đã trả). */
  rateDate: Date;
  /** Ngày dùng để tra "ai phụ trách": `confirmedAt` của GỐC nếu có gốc. */
  assigneeDate: Date;
  refundOfPaymentId: string | null;
};

export function mocCuaButToan(r: HangButToan): MocButToan {
  const laHoan = r.accountantStatus === "REFUNDED";
  const goc = r.adjustmentOf;
  return {
    centerId: r.centerId ?? r.order?.centerId ?? r.order?.lead?.centerId ?? null,
    paidDate: r.paidDate,
    rateDate: laHoan ? (goc?.paidDate ?? r.paidDate) : r.paidDate,
    assigneeDate: goc ? (goc.confirmedAt ?? goc.paidDate) : (r.confirmedAt ?? r.paidDate),
    refundOfPaymentId: laHoan ? r.adjustmentOfId : null,
  };
}

/** Kỳ tự nhiên (tháng VN) của bút toán — kỳ HIỆU LỰC (`naturalPeriod`). */
export function kyTuNhienCua(paidDate: Date): string {
  return kyCuaButToan(paidDate);
}
