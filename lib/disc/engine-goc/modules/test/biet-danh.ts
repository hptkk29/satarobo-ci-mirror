// NGUỒN: repo hodacphuchtc/DISC · đường dẫn gốc modules/test/biet-danh.ts · commit 5630a1c5605e580d688c5e8f52dedf4052aaed5c
// Bản vendoring NGUYÊN logic (chỉ đổi alias import @config/@modules -> @/lib/disc/engine-goc/...). Xem docs/disc-tich-hop/12-engine-tich-hop.md.
/**
 * BIỆT DANH — tên gọi để người dùng nhận ra bài của mình.
 *
 * 🔴 KHÔNG PHẢI HỌ TÊN. Đây là hàng rào dữ liệu cá nhân của trẻ em (NĐ 13/2023) đứng ở
 * chỗ gần người dùng nhất. Ứng dụng không thu họ tên, không thu ngày sinh — chỉ hỏi lớp,
 * và lớp chỉ dùng để định tuyến bộ đề.
 *
 * Hàm thuần, thuộc TẦNG LÕI: không React, không DOM.
 */

/** Đủ để phân biệt "Bi", "Bi lớn", "Bi nhà bác Tư" — không đủ cho một họ tên đầy đủ. */
export const DO_DAI_BIET_DANH_TOI_DA = 24;

/** Từ trở lên thì nhắc nhẹ: nghe như họ tên đầy đủ. Không chặn — chỉ nhắc. */
export const SO_TU_NGHI_HO_TEN = 3;

/**
 * Chuẩn hoá: NFC → bỏ khoảng trắng thừa → cắt theo SỐ KÝ TỰ NGƯỜI ĐỌC THẤY.
 *
 * Dùng `[...chuoi]` chứ không dùng `.length`: `.length` đếm theo mã UTF-16 nên chữ có dấu
 * gõ kiểu tổ hợp bị đếm thành 2, và ô nhập sẽ cắt cụt tên tiếng Việt sớm hơn tên không dấu.
 */
export function chuanHoaBietDanh(thoNhap: string): string {
  const sach = thoNhap.normalize("NFC").replace(/\s+/gu, " ").trimStart();
  return [...sach].slice(0, DO_DAI_BIET_DANH_TOI_DA).join("");
}

/** Đếm số ký tự người đọc thấy, không phải số mã UTF-16. */
export function demKyTu(chuoi: string): number {
  return [...chuoi.normalize("NFC")].length;
}

/** Rỗng hoặc toàn khoảng trắng thì không đi tiếp được — bài sẽ không nhận ra được là của ai. */
export function bietDanhHopLe(chuoi: string): boolean {
  return chuanHoaBietDanh(chuoi).trim().length > 0;
}

/** Nghe như họ tên đầy đủ không? Chỉ để NHẮC, tuyệt đối không dùng để chặn. */
export function nghiLaHoTen(chuoi: string): boolean {
  const tu = chuanHoaBietDanh(chuoi).trim().split(" ").filter(Boolean);
  return tu.length >= SO_TU_NGHI_HO_TEN;
}
