// lib/finance/hoa-don/nha-cung-cap/misa-adapter.ts — adapter MISA meInvoice = VỎ BỌC cổng `CongHoaDon` có sẵn.
//
// KHÔNG viết lại logic HTTP/token/ánh xạ: `phatHanh`/`traCuu`/`taiTep` chuyển tiếp NGUYÊN VẸN sang cổng
// (đối số và đối tượng kết quả y nguyên — kể cả KHONG_RO không bị bọc lại, không sinh refId). Cổng được TIÊM
// vào (`taoCongHsm` / `taoCongGiaLap` ở `lib/misa/meinvoice`) — adapter không đọc env, không tự chọn cổng.
//
// Bản đồ năng lực khai ĐÚNG thực tế mã (adapterImplements) và ĐÚNG tài liệu (providerSupports). Nguồn:
// docs/ke-toan-hoa-don/hub/audit/10-nha-cung-cap-capability-cong-khai.md (mức chắc chắn A/B/D/R/— ở mục 0)
// + audit 04 mục 5. `CongHoaDon` chỉ có 3 phương thức ⇒ mọi năng lực khác adapterImplements=false, DÙ nhà cung
// cấp có (đó chính là lý do hai cờ tách nhau — TD-05).

import type { CongHoaDon } from "@/lib/misa/meinvoice/cong";
import type { HoaDonNhaCungCap, MoiTruongVanHanh } from "./hop-dong";
import { taoBanDoNangLuc } from "./nang-luc";

export const BAN_DO_NANG_LUC_MISA = taoBanDoNangLuc({
  PHAT_HANH: {
    providerSupports: "CO",
    adapterImplements: true,
    ghiChu: "[A] POST /itg/invoicepublishing/publishhsm (ký HSM, một lời gọi). RefID là khoá chống trùng; http.ts:203.",
  },
  TRA_CUU_THEO_KHOA: {
    providerSupports: "CO",
    adapterImplements: true,
    ghiChu:
      "[A] POST …/invoicepublished/invoice-status/refid. ⚠️ RefID không tồn tại ⇒ tài liệu không nói trả gì; mã coi là CHUA_CO (anh-xa.ts:555, CHƯA XÁC MINH sandbox).",
  },
  TAI_PDF: {
    providerSupports: "CO",
    adapterImplements: true,
    ghiChu: "[A] POST …/downloadinvoice?downloadDataType=PDF, PDF là base64 (http.ts:255).",
  },
  TAI_XML: {
    providerSupports: "CO",
    adapterImplements: true,
    ghiChu: "[A] …/downloadinvoice?downloadDataType=XML. ⚠️ mã hoá XML của API v3 CHƯA XÁC MINH (http.ts:281) — mã nhận cả hai dạng và kiểm chữ ký tệp.",
  },
  KIEM_TRA_KET_NOI: {
    providerSupports: "CO",
    adapterImplements: false,
    ghiChu:
      "[A] POST /auth/token + GET /company có thật. [R] CongHoaDon không lộ phương thức kiểm kết nối; token lấy ngầm trong http.ts nên chưa có chỗ gọi riêng.",
  },
  LAY_PHAP_NHAN: {
    providerSupports: "CO",
    adapterImplements: false,
    ghiChu: "[A] GET /company?taxcode= (trả tên, địa chỉ, IsInvoiceWithCode). [R] repo chưa gọi: loại có mã/không mã khai bằng env.",
  },
  DANH_MUC_MAU_KY_HIEU: {
    providerSupports: "CO",
    adapterImplements: false,
    ghiChu: "[A, mơ hồ] GET /itg/InvoicePublishing/templates (trang ghi lẫn invyear/year). [R] repo chưa gọi: ký hiệu nhận từ phiếu.",
  },
  TRANG_THAI_CQT: {
    providerSupports: "CO",
    adapterImplements: false,
    ghiChu: "[A] POST …/invoicestatus (SendTaxStatus). [R] repo chưa gọi: DA_PHAT_HANH đặt thẳng từ phản hồi publish (anh-xa.ts:548).",
  },
  GUI_EMAIL: {
    providerSupports: "CO",
    adapterImplements: false,
    ghiChu: "[A] POST /itg/emails hoặc cờ IsSendEmail. [R] hệ thống TỰ gửi email, IsSendEmail=false (anh-xa.ts:100) — cố ý không nối.",
  },
  DIEU_CHINH: {
    providerSupports: "CO",
    adapterImplements: false,
    ghiChu: "[A] cùng endpoint phát hành, ReferenceType=2 + Org*. [R] phieuSangMisa không có trường tham chiếu; OD-10 chưa trả lời.",
  },
  THAY_THE: {
    providerSupports: "CO",
    adapterImplements: false,
    ghiChu:
      "[A] ReferenceType=1. ⚠️ thứ tự huỷ/thay thế CHƯA RÕ (hai mã lỗi nghe mâu thuẫn, phải thử sandbox). [R] repo chỉ huỷ NỘI BỘ (THAY_THE); OD-10 chưa trả lời.",
  },
  HUY: {
    providerSupports: "CO",
    adapterImplements: false,
    ghiChu: "[A] POST /itg/invoicepublished/cancel. [R] repo chỉ huỷ NỘI BỘ, không gọi API huỷ; OD-10 chưa trả lời.",
  },
  BAO_SAI_SOT: {
    providerSupports: "CHUA_XAC_MINH",
    adapterImplements: false,
    ghiChu: "[—] 22 mục API MISA công khai KHÔNG nêu thông báo sai sót 04/SS — 'không nêu' ≠ 'không hỗ trợ'. Đi đường thủ công.",
  },
});

function moiTruongVanHanhTuCong(moiTruong: CongHoaDon["moiTruong"]): MoiTruongVanHanh {
  switch (moiTruong) {
    case "gia-lap":
      return "GIA_LAP";
    case "sandbox":
      return "SANDBOX";
    case "production":
      return "THAT";
    default:
      // Giá trị lạ ⇒ KHÔNG đoán: đoán nhầm "sandbox" cho một cổng thật là phát hành hoá đơn thuế từ môi trường thử.
      throw new Error(`Môi trường cổng MISA không hỗ trợ: ${String(moiTruong)}`);
  }
}

/**
 * Bọc một `CongHoaDon` đã dựng sẵn (HSM thật hoặc GIA_LAP) thành adapter nhà cung cấp.
 *
 * ⚠️ Tên tham số là `congNoi`, KHÔNG phải `cong`: lưới `[PHM-W1]` (phat-hanh-misa.wiring.test.ts) khớp theo
 * mẫu `cong.phatHanh(` để bảo đảm "chỉ máy trạng thái gọi cổng lấy từ `layCongHoaDon()`". Adapter này nhận cổng
 * bằng TIÊM và CHƯA nối vào luồng phát hành, nên không phải đường mà lưới đó canh. Khi nối adapter vào máy trạng
 * thái (bước sau S1), cập nhật `[PHM-W1]` có chủ đích (danh sách đường được phép gọi cổng) thay vì giữ tên này.
 */
export function taoMisaMeInvoiceAdapter(congNoi: CongHoaDon): HoaDonNhaCungCap {
  const moiTruongVanHanh = moiTruongVanHanhTuCong(congNoi.moiTruong);
  return Object.freeze({
    nhaCungCap: "MISA_MEINVOICE" as const,
    moiTruongVanHanh,
    nangLuc: BAN_DO_NANG_LUC_MISA,
    phatHanh: (phieu) => congNoi.phatHanh(phieu),
    traCuu: (refId, mstNguoiBan) => congNoi.traCuu(refId, mstNguoiBan),
    taiTep: (maTraCuu, loai, mstNguoiBan) => congNoi.taiTep(maTraCuu, loai, mstNguoiBan),
  } satisfies HoaDonNhaCungCap);
}
