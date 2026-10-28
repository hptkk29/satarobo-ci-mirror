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
import type { HienThiPhieuPos, TheDangMo } from "./phieu-pos-luat";

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

/**
 * Phiếu thẻ ĐANG LÊN MÀN có phải là thẻ đang mở của phiếu gộp đang mở không (chờ quẹt, hay chờ kế toán).
 * Tách khỏi `nutThuThe` để hai nơi cùng đọc MỘT định nghĩa (hai nút QR / Thẻ POS, 09/10/2026): ô dòng đợt
 * và hộp thẻ. Chờ kế toán thắng — tiền đã trừ thì không còn là "chờ khách quẹt".
 *
 * ⚠️ Đây là phía MÀN (phiếu đã qua cửa sổ ẩn 30 phút của GĐ2 U9). Cái cổng máy chủ và các quyết định ở panel QR
 * hỏi là `kieuTheDangMo` (`phieu-pos-luat.ts`), không qua cửa sổ đó — xem TỰ QUYẾT V2.
 */
export function kieuPhieuPosDangMo(p: PhieuPosChoNut | null): TheDangMo | null {
  if (!p || !p.cuaPhieuDangMo) return null;
  if (p.choKeToan) return "CHO_KE_TOAN";
  return p.hienThi === "CHO_QUET" || p.hienThi === "THAT_BAI" ? "DANG_CHO" : null;
}

export function nutThuThe(v: DauVaoNutThuThe): NutThuThe {
  if (!v.duocThuThePos) return { kieu: "AN" };

  const p = v.phieuPos;
  const dangMo = p && p.paymentRequestIds.includes(v.paymentRequestId) ? kieuPhieuPosDangMo(p) : null;
  if (dangMo === "CHO_KE_TOAN") return { kieu: "CHO_KE_TOAN" };
  if (dangMo === "DANG_CHO") return { kieu: "DANG_CHO" };

  if (v.rowStatus === "PAID" || v.rowStatus === "VOID" || v.conThieu <= 0) return { kieu: "AN" };
  if (!v.bat || v.tt.kieu === "CU") return { kieu: "AN" };
  if (v.tt.kieu === "MOI_CUA_DOT_KHAC") return { kieu: "DOT_KHAC", nhanDotDangGiu: v.tt.nhanDotDangGiu };
  if (v.lyDoChuaDuyet !== null) return { kieu: "CHO_DUYET", lyDo: v.lyDoChuaDuyet };
  if (v.soMay <= 0) return { kieu: "CHUA_KHAI_MAY" };
  return { kieu: "TAO" };
}
