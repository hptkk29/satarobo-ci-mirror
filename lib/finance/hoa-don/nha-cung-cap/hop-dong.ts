// lib/finance/hoa-don/nha-cung-cap/hop-dong.ts — HỢP ĐỒNG của adapter nhà cung cấp hoá đơn (Invoice Hub, S6).
//
// Bám hợp đồng SẴN CÓ `CongHoaDon` (lib/misa/meinvoice/cong.ts) — KHÔNG đổi ngữ nghĩa:
//   · BA KẾT QUẢ phát hành: DA_PHAT_HANH | TU_CHOI (chắc chắn chưa có hoá đơn) | KHONG_RO (phải traCuu).
//   · KHONG_RO KHÔNG BAO GIỜ sinh refId mới: `refId` là khoá chống trùng do HỆ THỐNG sinh MỘT lần; nơi gọi
//     tra cứu THEO KHOÁ CŨ rồi mới được thử lại.
// …và thêm các năng lực còn lại dưới dạng phương thức TUỲ CHỌN, bật/tắt bằng bản đồ năng lực (`nang-luc.ts`).
//
// Lớp này CHƯA được nối vào luồng phát hành (`phat-hanh-misa.ts` vẫn lấy cổng qua `layCongHoaDon()`) — nối là
// bước sau, sau S1. Hiện chỉ dựng lớp + test để khi nối, hành vi MISA không đổi.

import type { KetQuaPhatHanh, KetQuaTraCuu, LoaiTep, PhieuPhatHanh } from "@/lib/misa/meinvoice/cong";
import type { BanDoNangLuc, NangLuc } from "./nang-luc";

export type { KetQuaPhatHanh, KetQuaTraCuu, LoaiTep, PhieuPhatHanh };

export const MA_NHA_CUNG_CAP = ["MISA_MEINVOICE", "VIN_HOADON", "VIETTEL_SINVOICE", "MOCK"] as const;
export type MaNhaCungCap = (typeof MA_NHA_CUNG_CAP)[number];

/**
 * Adapter đang nói với đâu:
 *   GIA_LAP = không gọi mạng, KHÔNG có giá trị pháp lý · SANDBOX = môi trường thử của nhà cung cấp ·
 *   THAT = môi trường thật (hoá đơn phát hành là chứng từ thuế, không xoá được) ·
 *   CHUA_CO = chưa nói với đâu cả (stub BLOCKED).
 */
export type MoiTruongVanHanh = "GIA_LAP" | "SANDBOX" | "THAT" | "CHUA_CO";

// ─── Kiểu cho các năng lực tuỳ chọn ─────────────────────────────────────────────────────────────────
// Chỉ là KHUNG hợp đồng để engine/UI mô hình hoá — chưa adapter thật nào hiện thực (OD-10 chưa trả lời: KHÔNG
// được gọi API huỷ/thay thế/điều chỉnh của nhà cung cấp). Không chứa trường riêng của một nhà cung cấp nào.

export type KetQuaKiemTraKetNoi = {
  ok: boolean;
  /** Câu cho người vận hành. KHÔNG BAO GIỜ chứa token/mật khẩu/AppID. */
  ghiChu: string;
};

export type ThongTinPhapNhanNcc = {
  mst: string;
  ten: string;
  diaChi: string | null;
  /** Hoá đơn có mã của CQT hay không mã; null = nhà cung cấp không nói. */
  coMa: boolean | null;
};

export type MauKyHieuNcc = {
  mauSo: string;
  kyHieu: string;
  daPhatHanh: boolean;
};

export type TrangThaiCqt = "CHUA_GUI" | "DA_GUI" | "CQT_TIEP_NHAN" | "CQT_TU_CHOI" | "LOI" | "KHONG_RO";
export type TrangThaiNcc = { trangThaiCqt: TrangThaiCqt; ghiChu: string | null };

/** Hoá đơn gốc mà điều chỉnh/thay thế/huỷ/báo sai sót tham chiếu tới. */
export type HoaDonGocNcc = {
  soHoaDon: string;
  kyHieu: string;
  ngayHoaDon: Date;
  maTraCuu: string;
};

export type YeuCauGuiEmailNcc = { maTraCuu: string; mstNguoiBan: string; nguoiNhan: readonly string[] };
export type KetQuaGuiEmailNcc = { loai: "DA_GUI" } | { loai: "TU_CHOI"; thongDiep: string } | { loai: "KHONG_RO"; thongDiep: string };

/** Điều chỉnh/thay thế phát hành MỘT hoá đơn mới ⇒ cùng ba kết quả và cùng luật khoá của `phatHanh`. */
export type YeuCauDieuChinhNcc = { phieu: PhieuPhatHanh; goc: HoaDonGocNcc; lyDo: string };
export type YeuCauThayTheNcc = { phieu: PhieuPhatHanh; goc: HoaDonGocNcc; lyDo: string };

export type YeuCauHuyNcc = { goc: HoaDonGocNcc; lyDo: string };
export type KetQuaHuyNcc = { loai: "DA_HUY" } | { loai: "TU_CHOI"; ma: string; thongDiep: string } | { loai: "KHONG_RO"; thongDiep: string };

export type YeuCauBaoSaiSotNcc = { goc: HoaDonGocNcc; lyDo: string };
export type KetQuaBaoSaiSotNcc = { loai: "DA_GUI"; maThamChieu: string | null } | { loai: "TU_CHOI"; ma: string; thongDiep: string } | { loai: "KHONG_RO"; thongDiep: string };

/**
 * Adapter nhà cung cấp. Ba phương thức lõi BẮT BUỘC có (giống `CongHoaDon`); phần còn lại tuỳ chọn và chỉ được
 * gọi khi `duocPhep(nangLuc, …)` — xem `chayNeuDuocPhep`.
 */
export interface HoaDonNhaCungCap {
  readonly nhaCungCap: MaNhaCungCap;
  readonly moiTruongVanHanh: MoiTruongVanHanh;
  readonly nangLuc: BanDoNangLuc;

  phatHanh(phieu: PhieuPhatHanh): Promise<KetQuaPhatHanh>;
  traCuu(refId: string, mstNguoiBan: string): Promise<KetQuaTraCuu>;
  taiTep(maTraCuu: string, loai: LoaiTep, mstNguoiBan: string): Promise<Uint8Array>;

  kiemTraKetNoi?(): Promise<KetQuaKiemTraKetNoi>;
  layPhapNhan?(mst: string): Promise<ThongTinPhapNhanNcc | null>;
  layDanhMucMauKyHieu?(mst: string, nam: number): Promise<readonly MauKyHieuNcc[]>;
  layTrangThai?(maTraCuu: string, mstNguoiBan: string): Promise<TrangThaiNcc>;
  guiEmail?(yeuCau: YeuCauGuiEmailNcc): Promise<KetQuaGuiEmailNcc>;
  dieuChinh?(yeuCau: YeuCauDieuChinhNcc): Promise<KetQuaPhatHanh>;
  thayThe?(yeuCau: YeuCauThayTheNcc): Promise<KetQuaPhatHanh>;
  huy?(yeuCau: YeuCauHuyNcc): Promise<KetQuaHuyNcc>;
  baoSaiSot?(yeuCau: YeuCauBaoSaiSotNcc): Promise<KetQuaBaoSaiSotNcc>;
}

export type PhuongThucNhaCungCap = Exclude<keyof HoaDonNhaCungCap, "nhaCungCap" | "moiTruongVanHanh" | "nangLuc">;

/**
 * Năng lực → phương thức hiện thực nó. `TAI_PDF` và `TAI_XML` cùng trỏ `taiTep` (một phương thức, hai định
 * dạng) nên cờ của chúng độc lập còn phương thức thì chung.
 */
export const PHUONG_THUC_CUA_NANG_LUC: Readonly<Record<NangLuc, PhuongThucNhaCungCap>> = Object.freeze({
  PHAT_HANH: "phatHanh",
  TRA_CUU_THEO_KHOA: "traCuu",
  TAI_PDF: "taiTep",
  TAI_XML: "taiTep",
  KIEM_TRA_KET_NOI: "kiemTraKetNoi",
  LAY_PHAP_NHAN: "layPhapNhan",
  DANH_MUC_MAU_KY_HIEU: "layDanhMucMauKyHieu",
  TRANG_THAI_CQT: "layTrangThai",
  GUI_EMAIL: "guiEmail",
  DIEU_CHINH: "dieuChinh",
  THAY_THE: "thayThe",
  HUY: "huy",
  BAO_SAI_SOT: "baoSaiSot",
});

/**
 * Lỗi MỘT adapter ném khi bị gọi vào năng lực nó chưa hỗ trợ (stub BLOCKED). Mã EN cố định cho máy đọc,
 * thông điệp tiếng Việt cho người. Engine KHÔNG được bắt rồi rơi sang nhà cung cấp khác.
 */
export class NhaCungCapChuaHoTro extends Error {
  readonly ma = "PROVIDER_NOT_SUPPORTED" as const;

  constructor(
    readonly nhaCungCap: MaNhaCungCap,
    readonly nangLuc: NangLuc,
    thongDiep: string,
  ) {
    super(thongDiep);
    this.name = "NhaCungCapChuaHoTro";
  }
}
