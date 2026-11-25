/**
 * lib/nguon/cua-so-ghi-cong.ts — CỬA SỔ GHI CÔNG (04 §7.3; setting `nguon.cuaSoGhiCongNgay`, mặc định 90). THUẦN.
 *
 * Quá hạn ⇒ GIỮ nguồn (báo cáo không đổi), KHÔNG sinh hoa hồng acquisition, và KHÔNG BAO GIỜ đổi sang `UNKNOWN`
 * (chốt 08/10/2026). Hàm này chỉ trả boolean — engine hoa hồng gọi sau; PR2 chưa có đường gọi nào ngoài test.
 *
 * Ngày đếm theo LỊCH VIỆT NAM: ngày gán = ngày VN của `attributedAt`; ngày so = ngày VN của `now`. Ngày thứ `ngay`
 * (gồm) còn TRONG cửa sổ, ngày thứ `ngay + 1` NGOÀI. `now` là TRUYỀN VÀO (luật 19) — thực tế là ngày thu tiền đầu
 * tiên của lần mua (04 §7.3), không phải đồng hồ hôm nay.
 */
import { congNgay, ngayVN, soNgayGiua } from "@/lib/format/thoi-gian-vn";

function kiemNgay(ngay: number): void {
  if (!Number.isInteger(ngay) || ngay < 1) {
    throw new Error(`Cửa sổ ghi công phải là số nguyên ≥ 1 ngày (nhận ${String(ngay)}).`);
  }
}

/**
 * Cửa sổ HIỆU LỰC của một khoản: `LeadSourceGroup.attributionWindowDays` của nguồn thắng; NULL ⇒ setting chung
 * (`nguon.cuaSoGhiCongNgay`). CHỖ DUY NHẤT chọn giữa hai số — engine (`dau-vao-chinh-sach`), "hạn ghi công" ở Sheet gán nguồn
 * và ảnh chụp ứng viên cùng gọi (luật 12b). Cả hai tham số BẮT BUỘC (luật 7). Kết quả đi qua cùng phép kiểm số ngày.
 */
export function cuaSoHieuLuc(riengCuaNguon: number | null, macDinhHeThong: number): number {
  const ngay = riengCuaNguon ?? macDinhHeThong;
  kiemNgay(ngay);
  return ngay;
}

/** `now` còn trong cửa sổ ghi công tính từ `attributedAt` không. `now` sớm hơn `attributedAt` ⇒ true. */
export function conTrongCuaSoGhiCong(attributedAt: Date, now: Date, ngay: number): boolean {
  kiemNgay(ngay);
  return soNgayGiua(ngayVN(attributedAt), ngayVN(now)) <= ngay;
}

/** Mốc cuối của cửa sổ: hết ngày VN thứ `ngay` kể từ ngày gán (23:59:59.999 giờ VN). */
export function hanCuaSoGhiCong(attributedAt: Date, ngay: number): Date {
  kiemNgay(ngay);
  const ngayCuoi = congNgay(ngayVN(attributedAt), ngay);
  return new Date(new Date(`${ngayCuoi}T23:59:59.999+07:00`).getTime());
}
