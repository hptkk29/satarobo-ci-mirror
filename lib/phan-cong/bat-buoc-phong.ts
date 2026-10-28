// lib/phan-cong/bat-buoc-phong.ts — BẮT BUỘC PHÒNG cho buổi học bù / Trial (chốt lượt 2 điểm 1, 27/10/2026). THUẦN.
//
// Đo prod: 19/63 = 30,2 % học bù / Trial từ 01/10 thiếu phòng (CS2 Trial 73,7 %). Thiếu phòng ⇒ luật ghép của màn Phân công (chốt
// GĐ1 số 1) coi buổi đó là GHÉP, nên Trial chồng giờ với lớp không bao giờ báo đỏ. Sửa tận nguồn:
//   · bản ghi MỚI (tạo case học bù · thêm buổi Trial) phải có phòng;
//   · bản ghi ĐÃ CÓ phòng không được gỡ về trống;
//   · bản ghi CŨ thiếu phòng (trước khi deploy) sửa mà vẫn thiếu thì CHO QUA — chỉ hiện cờ VÀNG "chưa có phòng" trên màn Phân công
//     (`lib/phan-cong/luoi-gop.ts`), không chặn, không đỏ.
// Một hàm cho mọi đường ghi (tạo / sửa / duyệt case học bù · thêm / sửa buổi Trial) — đừng viết lại điều kiện ở chỗ gọi.

export const LOI_THIEU_PHONG = "Chọn phòng học — bắt buộc cho buổi học bù / Trial (thiếu phòng thì màn Phân công không xét được trùng giờ).";
export const LOI_GO_PHONG = "Buổi đã có phòng — không bỏ trống phòng được, chỉ đổi sang phòng khác.";

/** `taoMoi` BẮT BUỘC (luật 7): mặc định sai là hoặc chặn sửa bản ghi cũ, hoặc cho bản ghi mới lọt thiếu phòng. */
export function lyDoThieuPhong(p: { taoMoi: boolean; phongTruoc: string | null; phongSau: string | null }): string | null {
  if (p.phongSau) return null;
  if (p.taoMoi) return LOI_THIEU_PHONG;
  return p.phongTruoc ? LOI_GO_PHONG : null;
}
