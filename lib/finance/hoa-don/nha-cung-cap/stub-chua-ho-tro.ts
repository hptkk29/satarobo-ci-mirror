// lib/finance/hoa-don/nha-cung-cap/stub-chua-ho-tro.ts — STUB cho nhà cung cấp BLOCKED: Viettel S-Invoice.
//
// ✅ VIN-HOADON đã RA KHỎI stub (02/11/2026): chủ dự án cấp PDF v13.0 ⇒ adapter thật ở `vin-adapter.ts` +
// `lib/vin-hoadon/*`. Phần còn thiếu của VIN là địa chỉ dịch vụ + credential sandbox (OD-07), không phải tài liệu.
//
// ⛔ TRẠNG THÁI: BLOCKED bởi OD-07 (docs/ke-toan-hoa-don/hub/00-QUYET-DINH-NEN-TANG.md):
//   · Viettel S-Invoice — chỉ có tài liệu mang danh Viettel chưa xác minh nguồn gốc (mức D) và thư viện không
//     chính thức (mức B); phần API hoá đơn không được tài liệu xác nhận (audit 10 mục 1.2). Cần tài liệu chính
//     thức + credential sandbox.
//
// Hợp đồng của stub: `adapterImplements=false` cho MỌI năng lực; `providerSupports="CHUA_XAC_MINH"` cho mọi
// năng lực (không dám nói "CO" cũng không dám nói "KHONG" khi chưa có tài liệu); MỌI lời gọi ném
// `NhaCungCapChuaHoTro` (mã EN `PROVIDER_NOT_SUPPORTED`, thông điệp tiếng Việt). Không gọi mạng, không đọc env,
// không chứa một địa chỉ dịch vụ nào — tệp này có test canh điều đó (`[HDNCC-ST-06]`).
//
// `moiTruongVanHanh="CHUA_CO"` ⇒ registry KHÔNG cho đăng ký stub ở cả TEST lẫn PROD.
// Gỡ BLOCKED = viết adapter thật, qua bộ test hợp đồng, rồi MỚI được bật `adapterImplements`.

import { NhaCungCapChuaHoTro, type HoaDonNhaCungCap, type MaNhaCungCap } from "./hop-dong";
import { NANG_LUC, taoBanDoNangLuc, type NangLuc } from "./nang-luc";

type KhaiStub = {
  readonly ma: Extract<MaNhaCungCap, "VIETTEL_SINVOICE">;
  readonly tenHienThi: string;
  /** Điều còn thiếu để gỡ BLOCKED — đưa thẳng vào thông điệp lỗi. */
  readonly canCo: string;
  /** Mức chắc chắn của nguồn đang có (đưa vào ghiChu của từng năng lực). */
  readonly nguonDangCo: string;
};

function dungBanDo(khai: KhaiStub) {
  const ghiChu = `[—] BLOCKED OD-07: ${khai.nguonDangCo}`;
  const muc = { providerSupports: "CHUA_XAC_MINH", adapterImplements: false, ghiChu } as const;
  const theoNangLuc = {} as Record<NangLuc, typeof muc>;
  for (const nl of NANG_LUC) theoNangLuc[nl] = muc;
  return taoBanDoNangLuc(theoNangLuc);
}

function thongDiepChan(khai: KhaiStub, nangLuc: NangLuc): string {
  return (
    `Nhà cung cấp ${khai.tenHienThi} chưa được hỗ trợ (BLOCKED – OD-07) nên không thể thực hiện năng lực ${nangLuc}. ` +
    `Cần: ${khai.canCo}. Hệ thống không tự đoán tham số của nhà cung cấp này.`
  );
}

function taoStub(khai: KhaiStub): HoaDonNhaCungCap {
  const chan =
    (nangLuc: NangLuc) =>
    async (): Promise<never> => {
      throw new NhaCungCapChuaHoTro(khai.ma, nangLuc, thongDiepChan(khai, nangLuc));
    };
  return Object.freeze({
    nhaCungCap: khai.ma,
    moiTruongVanHanh: "CHUA_CO" as const,
    nangLuc: dungBanDo(khai),
    phatHanh: chan("PHAT_HANH"),
    traCuu: chan("TRA_CUU_THEO_KHOA"),
    taiTep: (_maTraCuu, loai) => chan(loai === "pdf" ? "TAI_PDF" : "TAI_XML")(),
    kiemTraKetNoi: chan("KIEM_TRA_KET_NOI"),
    layPhapNhan: chan("LAY_PHAP_NHAN"),
    layDanhMucMauKyHieu: chan("DANH_MUC_MAU_KY_HIEU"),
    layTrangThai: chan("TRANG_THAI_CQT"),
    guiEmail: chan("GUI_EMAIL"),
    dieuChinh: chan("DIEU_CHINH"),
    thayThe: chan("THAY_THE"),
    huy: chan("HUY"),
    baoSaiSot: chan("BAO_SAI_SOT"),
  } satisfies HoaDonNhaCungCap);
}

export function taoViettelSInvoiceAdapter(): HoaDonNhaCungCap {
  return taoStub({
    ma: "VIETTEL_SINVOICE",
    tenHienThi: "Viettel S-Invoice",
    canCo: "tài liệu API hoá đơn chính thức của Viettel (đã xác minh nguồn) và credential sandbox",
    nguonDangCo:
      "chỉ có tài liệu mang danh Viettel chưa xác minh nguồn gốc (mức D) và thư viện không chính thức (mức B); chờ tài liệu chính thức + credential sandbox (audit 10 mục 1.2).",
  });
}
