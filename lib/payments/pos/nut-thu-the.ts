// lib/payments/pos/nut-thu-the.ts — ô "Thẻ POS" của MỘT dòng đợt vẽ gì (GĐ1 POS). THUẦN.
//
// Thiết kế: docs/pos-gd1-thiet-ke.md §7.2. Luật 12 — không vẽ nút chắc chắn bị máy chủ từ chối. Mỗi
// nhánh ở đây là cái bóng của một cổng trong `moPhieuPos` / `taoPhieuPosTrongKhoa`:
//   · DOT_KHAC      ⇔ `loiDotKhacDangGiu` (mỗi đơn một mã sống);
//   · CHO_DUYET     ⇔ T9 `lyDoChuaDuyetQr` (nút tắt, `title` = đúng câu của cổng);
//   · CHUA_KHAI_MAY ⇔ T10 (cơ sở chưa có máy POS đang bật);
//   · CHO_KE_TOAN   ⇔ T21 (giao dịch thẻ trước còn ở hàng chờ tay — không mời quẹt lần hai).
// Cổng thật vẫn ở máy chủ; ẩn nút không phải là kiểm quyền. Ca `[POS1-UI-01]`.
//
// ⚠️ Phiếu POS ĐANG CHỜ của dòng này mở lại được BẤT KỂ cờ / chờ duyệt (T8): kiểm tra + báo admin
// không hỏi cờ, và sale phải xem được kết quả của khoản đã quẹt kể cả khi cờ vừa tắt giữa chừng.
import type { TrangThaiQrDot } from "@/lib/payments/qr-theo-dot";
import type { HienThiPhieuPos } from "./phieu-pos-luat";

/** Phần của `PhieuPosView` mà ô dòng đợt cần. */
export type PhieuPosChoNut = {
  paymentRequestIds: readonly string[];
  cuaPhieuDangMo: boolean;
  hienThi: HienThiPhieuPos;
  choKeToan: boolean;
};

export type DauVaoNutThuThe = {
  /** `payments:pos-check`. */
  duocThuThePos: boolean;
  /** `billing.flexV1Enabled` của CƠ SỞ GIỮ ĐƠN. */
  bat: boolean;
  tt: TrangThaiQrDot;
  paymentRequestId: string;
  rowStatus: "PENDING" | "PARTIAL" | "PAID" | "VOID";
  /** Còn thiếu của dòng, đọc CẢ HAI SỔ (đợt sale thu tay = 0). */
  conThieu: number;
  lyDoChuaDuyet: string | null;
  /** Số máy POS đang bật của cơ sở giữ đơn. */
  soMay: number;
  phieuPos: PhieuPosChoNut | null;
};

export type NutThuThe =
  | { kieu: "AN" }
  | { kieu: "TAO" }
  | { kieu: "DANG_CHO" }
  | { kieu: "CHO_KE_TOAN" }
  | { kieu: "DOT_KHAC"; nhanDotDangGiu: string }
  | { kieu: "CHO_DUYET"; lyDo: string }
  | { kieu: "CHUA_KHAI_MAY" };

export function nutThuThe(v: DauVaoNutThuThe): NutThuThe {
  if (!v.duocThuThePos) return { kieu: "AN" };

  const p = v.phieuPos;
  if (p && p.cuaPhieuDangMo && p.paymentRequestIds.includes(v.paymentRequestId)) {
    if (p.choKeToan) return { kieu: "CHO_KE_TOAN" };
    if (p.hienThi === "CHO_QUET" || p.hienThi === "THAT_BAI") return { kieu: "DANG_CHO" };
  }

  if (v.rowStatus === "PAID" || v.rowStatus === "VOID" || v.conThieu <= 0) return { kieu: "AN" };
  if (!v.bat || v.tt.kieu === "CU") return { kieu: "AN" };
  if (v.tt.kieu === "MOI_CUA_DOT_KHAC") return { kieu: "DOT_KHAC", nhanDotDangGiu: v.tt.nhanDotDangGiu };
  if (v.lyDoChuaDuyet !== null) return { kieu: "CHO_DUYET", lyDo: v.lyDoChuaDuyet };
  if (v.soMay <= 0) return { kieu: "CHUA_KHAI_MAY" };
  return { kieu: "TAO" };
}
