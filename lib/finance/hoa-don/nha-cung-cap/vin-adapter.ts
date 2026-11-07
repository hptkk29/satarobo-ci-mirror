// lib/finance/hoa-don/nha-cung-cap/vin-adapter.ts — adapter VIN-HOADON = VỎ BỌC cổng `CongHoaDon` (lib/vin-hoadon).
//
// Cùng khuôn với `misa-adapter.ts`: KHÔNG viết lại logic HTTP/token/ánh xạ — `phatHanh`/`traCuu`/`taiTep` chuyển
// tiếp NGUYÊN VẸN sang cổng (kể cả KHONG_RO không bị bọc lại, không sinh refId). Cổng được TIÊM vào
// (`taoCongVin` ở `lib/vin-hoadon`) — adapter không đọc env, không tự chọn cổng, không gọi mạng.
//
// Nguồn của bản đồ năng lực: PDF "Hàm tích hợp hóa đơn điện tử — Version 13.0" của VIN-HOADON do chủ dự án cấp
// (đọc 02/11/2026; số trang = số trang PDF) ⇒ mức chắc chắn [A] cho `providerSupports`. `adapterImplements` chỉ
// bật cho thứ ĐÃ nối VÀ đã qua bộ test hợp đồng với fetch giả. ⚠️ Chưa có sandbox VIN ⇒ KHÔNG có năng lực nào
// từng được thử với dịch vụ thật; các điểm chưa kiểm chứng ghi rõ [?] trong lib/vin-hoadon/anh-xa.ts.

import type { CongHoaDon } from "@/lib/misa/meinvoice/cong";
import type { HoaDonNhaCungCap, MoiTruongVanHanh } from "./hop-dong";
import { taoBanDoNangLuc } from "./nang-luc";

export const BAN_DO_NANG_LUC_VIN = taoBanDoNangLuc({
  PHAT_HANH: {
    providerSupports: "CO",
    adapterImplements: true,
    ghiChu:
      "[A] PDF VIN v13.0 p66-77: POST …/QuanLyHoaDon/GuiVaKyHoadonGocHSM (gửi + ký HSM trong một lời gọi). ma_hoadon (≤50, duy nhất) là khoá chống trùng. [?] mã thành công 01 hay 31, và hành vi khi gửi trùng, CHƯA thử sandbox.",
  },
  TRA_CUU_THEO_KHOA: {
    providerSupports: "CO",
    adapterImplements: true,
    ghiChu:
      "[A] PDF VIN v13.0 p51-54: POST …/TraCuuHoaDon/TraThongTinHoaDon theo ma_hoadon (hoặc magiaodich). ⚠️ mã 11 'không tìm thấy' được đọc là CHUA_CO — CHƯA xác minh sandbox.",
  },
  TAI_PDF: {
    providerSupports: "CO",
    adapterImplements: true,
    ghiChu: "[A] PDF VIN v13.0 p118-119: …/TraCuuHoaDon/TaiHoaDonPdfKhongCanThueDuyet → base64pdf (tra bằng magiaodich = maTraCuu). Mã kiểm chữ ký '%PDF'.",
  },
  TAI_XML: {
    providerSupports: "CO",
    adapterImplements: true,
    ghiChu: "[A] PDF VIN v13.0 p120-121: …/TraCuuHoaDon/TaiXmlDaKy → base64xml. [?] có thể về chuỗi thô — mã nhận cả hai và kiểm ký tự đầu '<'.",
  },
  KIEM_TRA_KET_NOI: {
    providerSupports: "CO",
    adapterImplements: false,
    ghiChu:
      "[A] GetToken (p4-5) + ThongTinGoiDichVu (p172: số hoá đơn còn lại của gói). [R] token gắn với MST người bán còn kiemTraKetNoi() không có đối số; mã 20 'hết gói dịch vụ' là lý do nên nối sau.",
  },
  LAY_PHAP_NHAN: {
    providerSupports: "CHUA_XAC_MINH",
    adapterImplements: false,
    ghiChu: "[—] PDF v13.0 không có hàm tra thông tin pháp nhân — 'không nêu' ≠ 'không hỗ trợ'; chưa hỏi VIN.",
  },
  DANH_MUC_MAU_KY_HIEU: {
    providerSupports: "CO",
    adapterImplements: false,
    ghiChu: "[A] PDF VIN v13.0 p146-147: GET …/QuanLyHoaDon/DSMauHoaDonThongBao (mẫu số, ký hiệu, số hiện tại). [R] repo chưa gọi: ký hiệu nhận từ phiếu.",
  },
  TRANG_THAI_CQT: {
    providerSupports: "CO",
    adapterImplements: false,
    ghiChu: "[A] PDF VIN v13.0 p53: TraThongTinHoaDon trả trangthaicqt (0 chờ · 1 CQT xác nhận · 2 CQT từ chối) + mahoadoncqt. [R] repo chưa gọi.",
  },
  GUI_EMAIL: {
    providerSupports: "CO",
    adapterImplements: false,
    ghiChu: "[A] PDF VIN v13.0 p130: POST …/QuanLyHoaDon/GuiMailHoaDon (mã 24 hết lượt gửi, 25 email sai). [R] hệ thống TỰ gửi email — cố ý không nối.",
  },
  DIEU_CHINH: {
    providerSupports: "CO",
    adapterImplements: false,
    ghiChu:
      "[A] PDF VIN v13.0 p29-39 & p90-104: …/GuiVaKyHoaDonDieuChinhHSM (tham chiếu hoadon_goc) và …/GuiVaKyHoaDonDieuChinhGiamToanBoHSM. [R] OD-10 chưa trả lời ⇒ KHÔNG được gọi.",
  },
  THAY_THE: {
    providerSupports: "CO",
    adapterImplements: false,
    ghiChu: "[A] PDF VIN v13.0 p17-28 & p78-89: …/GuiVaKyHoaDonThayTheHSM (tham chiếu hoadon_goc). [R] OD-10 chưa trả lời ⇒ KHÔNG được gọi.",
  },
  HUY: {
    providerSupports: "KHONG",
    adapterImplements: false,
    ghiChu:
      "[A] PDF VIN v13.0 p40 & p105: hàm huỷ bỏ ghi 'bỏ hàm này theo NĐ 70' — huỷ đi qua thay thế hoặc điều chỉnh giảm toàn bộ (DIEU_CHINH/THAY_THE), không có hàm huỷ riêng.",
  },
  BAO_SAI_SOT: {
    providerSupports: "CO",
    adapterImplements: false,
    ghiChu: "[A] PDF VIN v13.0 p109-114: POST …/QuanLyHoaDon/GuiVaKyHoaDonSaiSotHSM (thông báo 04/SS-HĐĐT). [R] OD-10 chưa trả lời ⇒ KHÔNG được gọi.",
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
      throw new Error(`Môi trường cổng VIN-HOADON không hỗ trợ: ${String(moiTruong)}`);
  }
}

/**
 * Bọc một `CongHoaDon` đã dựng sẵn (`taoCongVin` thật, hoặc cổng GIA_LAP) thành adapter nhà cung cấp.
 * Tên tham số là `congNoi` (không phải `cong`) vì lưới `[PHM-W1]` khớp theo mẫu `cong.phatHanh(` — xem misa-adapter.ts.
 */
export function taoVinHoaDonAdapter(congNoi: CongHoaDon): HoaDonNhaCungCap {
  const moiTruongVanHanh = moiTruongVanHanhTuCong(congNoi.moiTruong);
  return Object.freeze({
    nhaCungCap: "VIN_HOADON" as const,
    moiTruongVanHanh,
    nangLuc: BAN_DO_NANG_LUC_VIN,
    phatHanh: (phieu) => congNoi.phatHanh(phieu),
    traCuu: (refId, mstNguoiBan) => congNoi.traCuu(refId, mstNguoiBan),
    taiTep: (maTraCuu, loai, mstNguoiBan) => congNoi.taiTep(maTraCuu, loai, mstNguoiBan),
  } satisfies HoaDonNhaCungCap);
}
