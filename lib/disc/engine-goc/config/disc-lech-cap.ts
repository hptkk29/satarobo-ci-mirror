// NGUỒN: repo hodacphuchtc/DISC · đường dẫn gốc config/disc-lech-cap.ts · commit 5630a1c5605e580d688c5e8f52dedf4052aaed5c
// Bản vendoring NGUYÊN logic (chỉ đổi alias import @config/@modules -> @/lib/disc/engine-goc/...). Xem docs/disc-tich-hop/12-engine-tich-hop.md.
/**
 * CHỖ VÊNH GIỮA HAI NGƯỜI BẤT KỲ TRONG NHÀ — trục quy chiếu là NGƯỜI ĐỌC (14.1).
 *
 * 🔴 VÌ SAO PHẢI ĐỔI TRỤC QUY CHIẾU.
 *
 * `LECH_PHONG_CACH` (GĐ9–GĐ10) khoá theo VAI: `"bo-me-cao-hon"` / `"bo-me-thap-hon"`. Nó
 * đúng khi chỉ có đúng hai người và một trong hai luôn là bố mẹ. Sang phân tích cả nhà thì
 * cặp có thể là *con ↔ anh*, *bố ↔ mẹ*, *bà ↔ cháu* — và câu hỏi "ai là bố mẹ?" không còn
 * câu trả lời.
 *
 * Trục mới là NGƯỜI ĐANG ĐỌC: `"toi-cao-hon"` / `"toi-thap-hon"`. Cùng MỘT chỗ vênh, A đọc
 * khoá `toi-cao-hon` còn B đọc `toi-thap-hon`. Nhờ vậy **vẫn chỉ 8 khoá** phủ cả hai chiều
 * của mọi cặp, thay vì nhân lên theo số quan hệ.
 *
 * 🔴 BẢNG CŨ GIỮ NGUYÊN, KHÔNG SỬA TẠI CHỖ. Màn *so phong cách* của bộ QS đang chạy tốt và
 * đã qua một vòng nội dung; sửa tại chỗ là đánh cược một thứ đang chạy để lấy một thứ chưa
 * chạy. Hai bảng sống cạnh nhau; khi nào bảng mới chứng minh được thì mới tính chuyện gộp.
 *
 * ── THẾ QUYỀN ────────────────────────────────────────────────────────────────
 *
 * Cùng một chỗ vênh, lời khuyên phải khác nhau tuỳ ai nói với ai. Bảo một đứa trẻ *"hãy
 * đợi mẹ nói hết"* là dạy con một kỹ năng; bảo nó *"hãy giúp mẹ chậm lại"* là giao cho nó
 * việc của người lớn. Ba thế quyền, không hơn:
 *
 *  · `nguoi-lon-voi-tre` — người lớn đọc về một đứa trẻ. Được phép nói tới việc điều chỉnh
 *    cách mình đối xử với trẻ.
 *  · `tre-voi-nguoi-lon` — trẻ đọc về một người lớn. 🔴 TUYỆT ĐỐI không giao cho trẻ việc
 *    quản lý cảm xúc hay hành vi của người lớn. Chỉ nói được: nói ra ý mình thế nào.
 *  · `ngang-vai` — hai người lớn, hoặc hai anh chị em. Nói thẳng được với nhau.
 *
 * 🔴 `ngang-vai` giữa hai NGƯỜI LỚN thuộc **GÓI KÝ DUYỆT B** — đó là phản hồi tính cách cho
 * một người lớn về chính họ và về bạn đời của họ, gần tham vấn hơn hẳn lời khuyên nuôi dạy.
 *
 * Thuộc TẦNG LÕI (ADR-004): chuỗi thuần, không React, không DOM.
 *
 * ⚠️ CHƯA CÓ NGƯỜI CHUYÊN MÔN KÝ DUYỆT. Xem mục CHỜ NGOÀI trong CLAUDE.md.
 */

/** Hướng lệch, nhìn từ NGƯỜI ĐANG ĐỌC. Soi gương: A `toi-cao-hon` ⇔ B `toi-thap-hon`. */
export const HUONG_LECH_CAP = ["toi-cao-hon", "toi-thap-hon"] as const;
export type HuongLechCap = (typeof HUONG_LECH_CAP)[number];

/** Ai đang nói với ai. Quyết định câu nào được phép nói. */
export const THE_QUYEN = ["nguoi-lon-voi-tre", "tre-voi-nguoi-lon", "ngang-vai"] as const;
export type TheQuyen = (typeof THE_QUYEN)[number];

/** Hai người cùng cao hoặc cùng nhẹ ở một trục. */
/**
 * MỐI QUAN HỆ CỦA MỘT LÁT CẮT (29.0) — mịn hơn `TheQuyen`.
 *
 * `TheQuyen` chỉ nói ai ở thế nào so với ai (người lớn/trẻ/ngang vai). Nội dung sâu cần biết
 * cụ thể hơn: vợ chồng khác anh chị em, người lớn với trẻ khác trẻ với người lớn. Luôn suy ra
 * được (không còn `undefined`) — trước 29.0 chỉ cặp vợ chồng và anh chị em có, các cặp còn lại
 * rơi im lặng về nội dung chung.
 */
export const MOI_QUAN_HE_CAP = [
  "vo-chong",
  "anh-chi-em",
  "nguoi-lon-khac",
  "nguoi-lon-voi-tre",
  "tre-voi-nguoi-lon",
] as const;
export type MoiQuanHeCap = (typeof MOI_QUAN_HE_CAP)[number];

export const KIEU_TRUNG_KHOP = ["cung-noi", "cung-nhe"] as const;
export type KieuTrungKhop = (typeof KIEU_TRUNG_KHOP)[number];

/**
 * Đại từ trong nội dung cặp.
 *
 * `{toi}` / `{Toi}` — người đang đọc tự xưng.
 * `{nguoiKia}` / `{NguoiKia}` — 🔴 thay bằng **TÊN đã lưu trong sổ** ("Mẹ Lan", "Bin").
 *
 * Vì sao dùng tên chứ không dùng đại từ quan hệ: tiếng Việt đòi biết giới tính và thứ bậc
 * để chọn đại từ, mà sản phẩm CỐ Ý không thu giới tính. Gọi bằng tên vừa tự nhiên vừa né
 * được việc phải suy ra một thứ chưa ai nhập. Bảng xưng hô nhờ đó co từ 49 ô xuống 7 phần
 * tử — và thêm ông bà, bố dượng về sau tốn **0 đoạn nội dung**.
 */
export const XUNG_HO_THEO_THE_QUYEN: Readonly<
  Record<TheQuyen, { readonly toi: string; readonly Toi: string }>
> = {
  "nguoi-lon-voi-tre": { toi: "bạn", Toi: "Bạn" },
  "tre-voi-nguoi-lon": { toi: "em", Toi: "Em" },
  "ngang-vai": { toi: "bạn", Toi: "Bạn" },
};

/**
 * Thay đại từ trong một đoạn nội dung cặp.
 *
 * 🔴 CỐ Ý KHÔNG dùng `CHU_THE[maBoDe]`. Bảng đó khoá theo BỘ ĐỀ, và chính giả định ngầm
 * *"một bộ đề = một người đọc"* đã cắt phụ huynh của mọi học sinh tiểu học và THCS khỏi
 * toàn bộ lời khuyên suốt từ GĐ9. Ở đây người đọc do THẾ QUYỀN quyết định, không do bộ đề.
 */
export function thayDaiTuCap(chuoi: string, theQuyen: TheQuyen, tenNguoiKia: string): string {
  const x = XUNG_HO_THEO_THE_QUYEN[theQuyen];
  return chuoi
    .split("{Toi}")
    .join(x.Toi)
    .split("{toi}")
    .join(x.toi)
    .split("{NguoiKia}")
    .join(tenNguoiKia)
    .split("{nguoiKia}")
    .join(tenNguoiKia);
}
