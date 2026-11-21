// components/admin/nguon-hoa-hong/nhan-khieu-nai.ts — CHỮ HIỂN THỊ của tab Khiếu nại (nhãn · mô tả đích · tuổi khiếu nại). THUẦN.
//
// Một chỗ cho cả bảng, Sheet và tin báo: hai nơi tự ghép chuỗi "SALE · 363.636đ" là hai nơi sẽ lệch nhau (luật 12b). Không in mã enum trần ra màn.
import type { PillTone } from "@/components/admin/ui/status-pill";
import type { DongKhieuNai } from "@/lib/hoa-hong/khieu-nai-doc";
import { NHAN_KET_QUA, type KetQuaKhieuNai, type TrangThaiKhieuNai } from "@/lib/hoa-hong/khieu-nai-trang-thai";
import { MASTER_VAI_HUONG } from "@/lib/hoa-hong/vai-huong";
import { dinhDangDong } from "@/lib/hoa-hong/vi-sao";

/** Tên vai người đọc được; mã lạ (vai thêm sau là dữ liệu, không phải hằng) thì in mã thay vì đoán. */
export const nhanVai = (code: string): string => MASTER_VAI_HUONG.find((v) => v.code === code)?.name ?? code;

/** Tông pill theo KẾT QUẢ (không theo enum trạng thái): "bị từ chối" và "đã duyệt" cùng là CLOSED nhưng khác nghĩa với người đọc. */
export const TONE_KET_QUA: Record<KetQuaKhieuNai, PillTone> = {
  CHO_XU_LY: "warning",
  DANG_XEM_XET: "info",
  DUOC_DUYET_DOI_NGUON: "success",
  DUOC_DUYET_DIEU_CHINH_TIEN: "success",
  TU_CHOI: "muted",
};

/** `StatusPill` tô bằng màu SÁNG (trượt AA trên nền trắng) nên luôn đè chữ `-ink` — cùng cách `NguonStatusPill`. */
export const INK_KET_QUA: Record<KetQuaKhieuNai, string> = {
  CHO_XU_LY: "text-state-warning-ink",
  DANG_XEM_XET: "text-state-info-ink",
  DUOC_DUYET_DOI_NGUON: "text-state-success-ink",
  DUOC_DUYET_DIEU_CHINH_TIEN: "text-state-success-ink",
  TU_CHOI: "",
};

/**
 * "Duyệt theo cách sửa nguồn" mà khiếu nại CHƯA đóng (trạng thái APPROVED) là việc còn TREO: tiền chỉ điều chỉnh khi người ta đổi nguồn ở màn lead. Cho nó pill "xong" xanh là báo
 * xong trong khi việc chưa làm — nên nhãn/tông/chữ đi qua ba hàm dưới (một chỗ, cho cả bảng lẫn Sheet).
 */
export const dangChoDoiNguon = (k: KetQuaKhieuNai, t: TrangThaiKhieuNai): boolean => k === "DUOC_DUYET_DOI_NGUON" && t === "APPROVED";
export const nhanKetQuaHienThi = (k: KetQuaKhieuNai, t: TrangThaiKhieuNai): string => (dangChoDoiNguon(k, t) ? "Đã duyệt — chờ đổi nguồn" : NHAN_KET_QUA[k]);
export const toneKetQuaHienThi = (k: KetQuaKhieuNai, t: TrangThaiKhieuNai): PillTone => (dangChoDoiNguon(k, t) ? "warning" : TONE_KET_QUA[k]);
export const inkKetQuaHienThi = (k: KetQuaKhieuNai, t: TrangThaiKhieuNai): string => (dangChoDoiNguon(k, t) ? "text-state-warning-ink" : INK_KET_QUA[k]);

/** Cột "Về" của bảng: KHÔNG kèm số tiền (số tiền có cột riêng, căn phải, không bị cắt) — chỉ vai/đơn + kỳ. */
export function moTaDichNgan(d: DongKhieuNai["dich"]): string {
  return d.loai === "DONG" ? `${nhanVai(d.vai)} · kỳ ${d.ky}` : `Khoản thu${d.maDon ? ` · đơn ${d.maDon}` : ""}`;
}

/** Dòng "Về": dòng của mình hay khoản thu. Ngắn, đủ phân biệt hai khiếu nại liền nhau. */
export function moTaDich(d: DongKhieuNai["dich"]): string {
  return d.loai === "DONG"
    ? `${nhanVai(d.vai)} · ${dinhDangDong(d.soTien)} · kỳ ${d.ky}`
    : `Khoản thu ${dinhDangDong(d.soTien)}${d.maDon ? ` · đơn ${d.maDon}` : ""}`;
}

/** "hôm nay" / "1 ngày" / "12 ngày" — tuổi của khiếu nại ĐANG MỞ. */
export function tuoiMo(soNgay: number): string {
  if (soNgay <= 0) return "hôm nay";
  return `${soNgay} ngày`;
}

/** Mã ngắn người đọc đọc được qua điện thoại: 6 ký tự cuối id, in hoa (cùng cách `khieu-nai-thong-bao`). */
export const maKhieuNai = (id: string): string => id.slice(-6).toUpperCase();
