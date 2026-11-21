// lib/finance/hoa-don/o-so-hoa-don.ts — kiểm + chuẩn hoá BA Ô SỐ kế toán gõ khi lưu nháp. THUẦN.
//
// Ký hiệu · số hoá đơn · ngày phát hành. Lưu nháp được khi còn TRỐNG ô (kế toán tải tệp trước, gõ
// số sau) — nút Xác nhận tự nói "Còn thiếu …" (`hanhDongChoDong`). Nhưng ô ĐÃ gõ thì phải đúng.
//
// ⚠️ Số hoá đơn bỏ số 0 đứng đầu: MISA in "00000127" trên tờ nhưng "127" trên danh sách. Không
// chuẩn hoá thì hai kế toán gõ hai kiểu và khoá DB `(MST, ký hiệu, số)` coi là HAI hoá đơn.
// ⚠️ Ngày phát hành không được ở TƯƠNG LAI theo lịch VN — `homNay` do người gọi truyền (luật 19:
// hàm không tự đọc đồng hồ).

import { dungHinhDangKyHieu, kiemKyHieu } from "./ky-hieu";
import { kyHieuDeXuat, type CauHinhCoSo, type KyHieuDeXuat } from "./cau-hinh-co-so";

export type OSoHoaDon = { kyHieu: string | null; soHoaDon: string | null; ngayPhatHanh: Date | null };

const NGAY = /^(\d{4})-(\d{2})-(\d{2})$/;

function ngayHopLe(s: string): Date | null {
  const m = NGAY.exec(s);
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  // 2026-02-31 → Date tự tràn sang tháng 3: bắt bằng cách so ngược.
  return d.toISOString().slice(0, 10) === s ? d : null;
}

export function kiemOSoHoaDon(
  input: { kyHieu?: string | null; soHoaDon?: string | null; ngayPhatHanh?: string | null },
  /** yyyy-mm-dd theo lịch VN. */
  homNay: string,
): { ok: true; data: OSoHoaDon } | { ok: false; error: string } {
  const kyHieu = input.kyHieu?.trim().toUpperCase() || null;
  const soTho = input.soHoaDon?.trim() || null;
  const ngayTho = input.ngayPhatHanh?.trim() || null;

  let ngayPhatHanh: Date | null = null;
  if (ngayTho) {
    ngayPhatHanh = ngayHopLe(ngayTho);
    if (!ngayPhatHanh) return { ok: false, error: "Ngày phát hành không hợp lệ" };
    if (ngayTho > homNay) return { ok: false, error: "Ngày phát hành không được sau hôm nay" };
    if (ngayTho < "2020-01-01") return { ok: false, error: "Ngày phát hành quá xa — kiểm lại năm" };
  }

  let soHoaDon: string | null = null;
  if (soTho) {
    if (!/^\d{1,8}$/.test(soTho)) return { ok: false, error: "Số hoá đơn chỉ gồm chữ số (tối đa 8 số)" };
    soHoaDon = soTho.replace(/^0+/, "");
    if (!soHoaDon) return { ok: false, error: "Số hoá đơn phải lớn hơn 0" };
  }

  if (kyHieu) {
    const loi = ngayPhatHanh ? kiemKyHieu(kyHieu, ngayPhatHanh) : dungHinhDangKyHieu(kyHieu) ? null : "Ký hiệu hoá đơn không đúng dạng (ví dụ đúng: 1C26TSR).";
    if (loi) return { ok: false, error: loi };
  }

  return { ok: true, data: { kyHieu, soHoaDon, ngayPhatHanh } };
}

/**
 * Giá trị điền sẵn cho ba ô khi mở một lần thu (23/10/2026). THUẦN.
 *   · Có bản NHÁP: ô nào nháp đã lưu thì giữ NGUYÊN (kế toán đã chốt tay), ô nháp để trống mới điền sẵn.
 *   · Ngày phát hành mặc định = NGÀY THU (lịch VN — `ngayThu` đã là chuỗi ngày VN của lần thu).
 *   · Ký hiệu mặc định = ký hiệu của CẤU HÌNH cơ sở hiệu lực vào NGÀY PHÁT HÀNH vừa điền; không có cấu hình ⇒ để trống.
 *   · `kyHieuTay` = ký hiệu đang là giá trị kế toán đã tự chốt (nháp có ký hiệu) ⇒ đổi ngày không ghi đè.
 * Chỉ dùng làm giá trị KHỞI TẠO của form (đã `key={dong.key}`): rerender không chạy lại, nên không đè giá trị gõ tay.
 */
export function oSoDienSan(input: {
  nhap: { ngayPhatHanh: string | null; kyHieu: string | null } | null;
  ngayThu: string;
  /** Cơ sở của lần thu + cấu hình hoá đơn ĐANG BẬT của cơ sở (PR2). Vắng cấu hình ⇒ ký hiệu để TRỐNG (không đoán). */
  coSoId: string | null;
  cauHinhCoSo: readonly CauHinhCoSo[];
}): { ngayPhatHanh: string; kyHieu: string; kyHieuTay: boolean; nguonKyHieu: KyHieuDeXuat["nguon"] | "NHAP" } {
  const ngayThu = NGAY.test(input.ngayThu) ? input.ngayThu : "";
  const ngayPhatHanh = input.nhap?.ngayPhatHanh || ngayThu;
  const kyHieuNhap = input.nhap?.kyHieu || "";
  if (kyHieuNhap) return { ngayPhatHanh, kyHieu: kyHieuNhap, kyHieuTay: true, nguonKyHieu: "NHAP" };
  const de = kyHieuDeXuat({ cauHinh: input.cauHinhCoSo, centerId: input.coSoId ?? "", ngay: ngayPhatHanh });
  return { ngayPhatHanh, kyHieu: de.kyHieu, kyHieuTay: false, nguonKyHieu: de.nguon };
}

/** Tên tệp người dùng chọn — bỏ đường dẫn, ký tự điều khiển; cắt 150. Chỉ để HIỂN THỊ / đặt tên tải về. */
export function tenTepSach(ten: string, duoi: "pdf" | "xml"): string {
  const goc = ten.split(/[\\/]/).pop() ?? "";
  // eslint-disable-next-line no-control-regex
  const sach = goc.replace(/[\u0000-\u001f\u007f"]/g, "").trim().slice(0, 150);
  return sach || `hoa-don.${duoi}`;
}
