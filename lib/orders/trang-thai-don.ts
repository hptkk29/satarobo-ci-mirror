// lib/orders/trang-thai-don.ts — TRẠNG THÁI CỦA MỘT ĐƠN, SUY TỪ TIỀN. Thuần.
//
// ─────────────────────────────────────────────────────────────────────────────
// CHỦ DỰ ÁN CHỐT 16/09/2026
//
// *"hiện tại trạng thái ban đầu của đơn hàng có các trạng thái: nháp, chờ thanh toán, đã
// xác nhận đơn, ngoài ra còn đã hoàn tất, và đã hoàn tiền, đối với quy trình đóng học phí
// nhiều đợt hiện tại thì các trạng thái này không phù hợp nữa rồi, và cũng không cần phải
// bấm tay hay chọn tay nữa đâu, thiết kế lại trạng thái của các đơn hàng cho hợp lý và dựa
// vào tình trạng Giao dịch của KH để cho hiển thị ra trạng thái phù hợp"*
//
// Và khi được hỏi "suy từ SỔ NÀO" (bốn sổ đang trả bốn số "đã thu" khác nhau cho cùng một
// đơn), chủ dự án chọn: **HAI TRỤC — sale đã thu + kế toán đã xác nhận.** Đó là lý do hàm
// này không trả một nhãn duy nhất mà trả kèm cả hai con số.
//
// ⚠️ ĐÂY LÀ ĐẢO MỘT CHỐT CŨ CỦA CHÍNH CHỦ DỰ ÁN ("Không đụng vào máy trạng thái đơn"), và
// nói ra ở đây là cố ý. Nhưng đợt này KHÔNG đụng máy trạng thái: không đổi enum, không bỏ
// cột, không sửa đường ghi nào. Nó chỉ thêm một câu trả lời ĐỌC được cho màn hình. Việc
// gỡ nút bấm tay là đợt sau, và nó cần đúng hàm này tồn tại trước.
//
// ─────────────────────────────────────────────────────────────────────────────
// VÌ SAO `Order.status` KHÔNG TRẢ LỜI ĐƯỢC — SỐ ĐO TRÊN `satarobo_local` 16/09/2026
//
// Cột đó gánh HAI câu hỏi bằng MỘT giá trị: (a) tiền đã thu tới đâu, (b) đơn đã bàn
// giao/huỷ/hoàn chưa. `prisma/schema.prisma` khai `COMPLETED // fulfilled (e.g., student
// attended class, kit delivered)` — tức nghĩa GIAO HÀNG. Nhưng các đường đọc lại dùng nó
// làm SỐ TIỀN.
//
//   · 384 đơn mang `CONFIRMED`/`COMPLETED`; tổng `totalAmount` = 1.785.608.000đ, nhưng kế
//     toán chỉ xác nhận 1.400.301.000đ ⇒ **khai thừa 385.307.000đ**;
//   · trong đó **43 đơn chưa đóng một đồng nào** mà vẫn mang nhãn đã chốt;
//   · **108/507 đơn (21,3%)** mang nhãn "đã chốt/hoàn tất" trong khi còn nợ. Lệch đi ĐÚNG
//     MỘT CHIỀU: 0 đơn mang nhãn chưa-thu mà thực ra đã đủ. Nhãn luôn nói QUÁ.
//
// Hai đường đọc còn sống đang ăn con số sai đó:
//   · `lib/crm/funnel-query.ts` — `revenue = Σ totalAmount WHERE status IN (CONFIRMED,
//     COMPLETED)`, tức doanh thu funnel = tiền chưa về;
//   · `lib/finance/debt.ts` `getOverdueOrders` — lọc CỨNG `status: "PENDING_PAYMENT"`, nên
//     **108 đơn còn nợ 385.307.000đ** (79 CONFIRMED + 29 COMPLETED) VÔ HÌNH với cron nhắc
//     nợ. Cron chỉ thấy 123 đơn PENDING_PAYMENT.
//
// ⚠️ ĐÍNH CHÍNH MỘT CHẨN ĐOÁN SAI, ghi lại để không ai đi lại: `debt.ts` `paidOf()` TRÔNG
// như thủ phạm ("CONFIRMED/COMPLETED ⇒ trả đủ") nhưng nó là **MÃ CHẾT** — 0 đường gọi
// trong mã chạy thật, chỉ test của chính nó. Và màn dashboard kế toán từng dùng công thức
// tương đương thì **đã được vá 13/09** (R-13, gỡ `PAID_STATUSES`). Chữa `paidOf` là chữa
// một tệp không ai đọc. Đường thật là hai chỗ kể trên.
//
// ─────────────────────────────────────────────────────────────────────────────
// KHÔNG ĐẺ ĐỊNH NGHĨA "ĐÃ THU" THỨ TÁM
//
// Repo này đã có ≥7 định nghĩa "đã thu". Hàm này KHÔNG cộng tiền: nó nhận `CongNoDon` —
// đầu ra của `congNoDon` (`lib/finance/cong-no-don.ts`), vốn đã nhận sẵn hai con số từ
// trục A (`lib/finance/debt.ts`) và trục B (`lib/finance/ghi-nhan.ts`). Việc duy nhất ở
// đây là ĐẶT TÊN cho tổ hợp số đó.
//
// Cùng họ với `trangThaiDot` (`lib/payments/trang-thai-dot.ts`) — trả lời đúng câu này cho
// MỘT ĐỢT. Hàm này là cấp ĐƠN. Nếu bạn cần trạng thái một đợt, gọi hàm kia, đừng gọi hàm
// này rồi suy xuống.
import type { CongNoDon } from "@/lib/finance/cong-no-don";

/**
 * Trạng thái mà TIỀN KHÔNG SUY RA ĐƯỢC — phải là quyết định của người.
 *
 * Đây là ngoại lệ có chủ đích của chốt "không bấm tay nữa", và nó phải được nói ra chứ
 * không lách: không phép cộng nào trên ba sổ tiền cho biết một đơn đã bị HUỶ hay đã HOÀN
 * TIỀN. Đơn huỷ và đơn chưa ai đóng tiền có cùng một bộ số (đã thu 0, còn thiếu đủ) nhưng
 * là hai việc khác nhau hoàn toàn.
 *
 * `DRAFT` cũng vào đây: đơn nháp chưa phải một thoả thuận, in "Chưa đóng" lên nó là hàm ý
 * khách đang nợ.
 *
 * ⚠️ Mọi giá trị KHÁC của `Order.status` (`PENDING_PAYMENT`, `CONFIRMED`, `COMPLETED`) bị
 * **BỎ QUA** — đó là toàn bộ mục đích của đợt này. Chúng là thứ đang nói quá ở 108/507 đơn.
 */
export const TRANG_THAI_NGUOI_QUYET = ["DRAFT", "CANCELLED", "REFUNDED"] as const;

export const MA_TRANG_THAI_DON = {
  /** Đơn nháp — chưa phải thoả thuận. Từ `Order.status`. */
  NHAP: "NHAP",
  /** Đã huỷ. Từ `Order.status` — tiền không suy ra được. */
  HUY: "HUY",
  /** Đã hoàn tiền. Từ `Order.status` — tiền không suy ra được. */
  HOAN_TIEN: "HOAN_TIEN",
  /** Chưa có số tiền để nói gì (`phaiDong <= 0`). Dữ liệu cần người xem, không phải "xong". */
  CHUA_CO_SO: "CHUA_CO_SO",
  /** Chưa về đồng nào. */
  CHUA_THU: "CHUA_THU",
  /** Đã về một phần — đây là ô mà `Order.status` không bao giờ biểu diễn được. */
  DANG_THU: "DANG_THU",
  /** Tiền đã về đủ, kế toán CHƯA đối soát hết (trục B ≥ phải đóng, còn chênh A/B). */
  DU_CHO_DOI_SOAT: "DU_CHO_DOI_SOAT",
  /** Đã về đủ VÀ kế toán đã đối soát hết. */
  DA_DOI_SOAT: "DA_DOI_SOAT",
  /** Thu quá tổng đơn — luôn cần người xem. */
  THU_VUOT: "THU_VUOT",
} as const;

export type MaTrangThaiDon =
  (typeof MA_TRANG_THAI_DON)[keyof typeof MA_TRANG_THAI_DON];

/** Sắc thái cho badge. Khoá NGỮ NGHĨA — tệp thuần không giữ tên lớp Tailwind. */
export type SacThaiTrangThai = "trung-tinh" | "dang-cho" | "thanh-cong" | "canh-bao";

export type TrangThaiDon = {
  ma: MaTrangThaiDon;
  /** Nhãn chính cho badge. */
  nhan: string;
  /**
   * Vế thứ hai của HAI TRỤC — `null` khi không có gì để nói thêm.
   *
   * Chủ dự án chốt hiển thị hai trục, nên chênh lệch A/B KHÔNG được nuốt vào nhãn chính:
   * "Đã đóng đủ" và "kế toán đã đối soát" là hai sự thật khác nhau, và 49/507 đơn trên
   * `satarobo_local` đang ở đúng khoảng giữa hai câu đó.
   */
  nhanPhu: string | null;
  sacThai: SacThaiTrangThai;
  /** Tiền còn phải đóng (trục B). 0 khi đã đủ. */
  conThieu: number;
  /** Tiền đã về mà kế toán chưa đối soát (B − A). Việc nội bộ, KHÔNG phải nợ của khách. */
  choDoiSoat: number;
  /** `true` khi nhãn đến từ `Order.status` chứ không từ tiền — để màn hình nói thật. */
  doNguoiQuyet: boolean;
};

/**
 * Trạng thái của một đơn.
 *
 * `status` là `Order.status` thô; `so` là đầu ra `congNoDon`. Nhận status dạng chuỗi (không
 * phải enum Prisma) để tệp này không kéo `@prisma/client` vào bundle trình duyệt — cùng lý
 * do `cong-no-don.ts` import từ `debt-pure` chứ không từ `debt`.
 *
 * ⚠️ THỨ TỰ NHÁNH CÓ NGHĨA, đừng sắp lại:
 *  1. Quyết định của NGƯỜI thắng tiền. Đơn đã huỷ mà in "Đang đóng" vì còn một khoản cũ
 *     trong sổ là nói dối về một việc đã đóng lại.
 *  2. THU_VUOT trước DA_DOI_SOAT. Thu vượt thì `xong` cũng đúng, nhưng thu vượt là ca cần
 *     người xem — để `xong` thắng là giấu nó đi.
 *  3. Chênh A/B tách DU_CHO_DOI_SOAT khỏi DA_DOI_SOAT. Gộp hai cái là bỏ mất đúng tín hiệu
 *     dùng để phát hiện webhook hỏng (xem đầu `lib/finance/ghi-nhan.ts`).
 */
export function trangThaiDon(input: {
  status: string;
  so: CongNoDon;
}): TrangThaiDon {
  const { status, so } = input;
  const nen = {
    conThieu: so.conThieu,
    choDoiSoat: so.choXacNhan,
  };

  // ── 1. Quyết định của NGƯỜI ────────────────────────────────────────────────
  if (status === "CANCELLED") {
    return {
      ...nen,
      ma: MA_TRANG_THAI_DON.HUY,
      nhan: "Đã huỷ",
      nhanPhu: so.daThu > 0 ? "Có khoản đã thu — kiểm tra hoàn tiền" : null,
      sacThai: "trung-tinh",
      doNguoiQuyet: true,
    };
  }
  if (status === "REFUNDED") {
    return {
      ...nen,
      ma: MA_TRANG_THAI_DON.HOAN_TIEN,
      nhan: "Đã hoàn tiền",
      nhanPhu: null,
      sacThai: "trung-tinh",
      doNguoiQuyet: true,
    };
  }
  if (status === "DRAFT") {
    return {
      ...nen,
      ma: MA_TRANG_THAI_DON.NHAP,
      nhan: "Nháp",
      nhanPhu: "Chưa phải thoả thuận — chưa tính là công nợ",
      sacThai: "trung-tinh",
      doNguoiQuyet: true,
    };
  }

  // ── 2. Từ đây TIỀN quyết. `status` không còn được đọc. ─────────────────────
  if (so.traVuot > 0) {
    return {
      ...nen,
      ma: MA_TRANG_THAI_DON.THU_VUOT,
      nhan: "Thu vượt",
      nhanPhu: "Tiền về nhiều hơn tổng đơn — cần kiểm tra",
      sacThai: "canh-bao",
      doNguoiQuyet: false,
    };
  }
  if (so.phaiDong <= 0) {
    return {
      ...nen,
      ma: MA_TRANG_THAI_DON.CHUA_CO_SO,
      nhan: "Chưa có số tiền",
      nhanPhu: "Đơn 0đ — cần người xem, không tính là đã đóng đủ",
      sacThai: "canh-bao",
      doNguoiQuyet: false,
    };
  }
  if (so.xong) {
    return so.choXacNhan > 0
      ? {
          ...nen,
          ma: MA_TRANG_THAI_DON.DU_CHO_DOI_SOAT,
          nhan: "Đã đóng đủ",
          nhanPhu: "Chờ kế toán đối soát",
          sacThai: "dang-cho",
          doNguoiQuyet: false,
        }
      : {
          ...nen,
          ma: MA_TRANG_THAI_DON.DA_DOI_SOAT,
          nhan: "Đã đóng đủ",
          nhanPhu: "Kế toán đã đối soát",
          sacThai: "thanh-cong",
          doNguoiQuyet: false,
        };
  }
  if (so.daThu > 0) {
    return {
      ...nen,
      ma: MA_TRANG_THAI_DON.DANG_THU,
      nhan: "Đang đóng",
      nhanPhu: so.choXacNhan > 0 ? "Có khoản chờ kế toán đối soát" : null,
      sacThai: "dang-cho",
      doNguoiQuyet: false,
    };
  }
  return {
    ...nen,
    ma: MA_TRANG_THAI_DON.CHUA_THU,
    nhan: "Chưa đóng",
    nhanPhu: null,
    sacThai: "canh-bao",
    doNguoiQuyet: false,
  };
}
