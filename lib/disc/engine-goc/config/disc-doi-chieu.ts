// NGUỒN: repo hodacphuchtc/DISC · đường dẫn gốc config/disc-doi-chieu.ts · commit 5630a1c5605e580d688c5e8f52dedf4052aaed5c
// Bản vendoring NGUYÊN logic (chỉ đổi alias import @config/@modules -> @/lib/disc/engine-goc/...). Xem docs/disc-tich-hop/12-engine-tich-hop.md.
/**
 * VĂN BẢN VÙNG LỆCH con ↔ cha mẹ (DISC_BA.md §8.4).
 *
 * Cơ sở: chênh lệch giữa hai người đánh giá (*informant discrepancies*) từng bị coi là
 * sai số đo. Dòng nghiên cứu De Los Reyes đảo lại: chênh lệch đó LÀ TÍN HIỆU về sự khác
 * nhau của hành vi trẻ theo NGỮ CẢNH. Trẻ hành xử khác ở nhà và ở lớp là chuyện bình
 * thường; đo được sự khác nhau đó có giá trị riêng.
 *
 * 🔴 `lech > 0` = con TỰ THẤY mình cao hơn cha mẹ thấy. `lech < 0` = ngược lại.
 * 🔴 Chỉ diễn giải TỐI ĐA HAI trục lệch lớn nhất. Diễn giải cả bốn là bắt phụ huynh đọc
 *    một bài luận rồi không nhớ được gì.
 *
 * ⚠️ CHƯA CÓ NGƯỜI CHUYÊN MÔN KÝ DUYỆT — xem mục "CHỜ NGOÀI" trong CLAUDE.md.
 */

import type { MaTruc } from "@/lib/disc/engine-goc/modules/core/bo-de/kieu";

export type HuongLech = "con-cao-hon" | "con-thap-hon";

export const NHAN_MUC_LECH = {
  trungKhop: { ten: "Trùng khớp", mau: "#2E9E6B" },
  hoiKhac: { ten: "Hơi khác", mau: "#FF8F2D" },
  khacRo: { ten: "Khác rõ", mau: "#610B8A" },
} as const;

export type MaMucLech = keyof typeof NHAN_MUC_LECH;

export const VAN_BAN_LECH: Readonly<Record<MaTruc, Readonly<Record<HuongLech, string>>>> = {
  D: {
    "con-cao-hon":
      "Con tự thấy mình chủ động hơn bố mẹ nhìn thấy. Ở nhà con có thể đang giữ hoà khí; ở lớp hoặc chỗ bạn bè, con có thể đang là người cầm trịch mà bố mẹ chưa thấy.",
    "con-thap-hon":
      "Bố mẹ thấy con mạnh mẽ hơn con tự thấy. Có thể con quyết đoán ở nhà nhưng ra ngoài thì dè dặt hơn — đáng để hỏi con xem ở lớp con thấy thế nào.",
  },
  I: {
    "con-cao-hon":
      "Con thấy mình cởi mở hơn bố mẹ nhìn thấy. Trẻ hay ít nói ở nhà mà rất rôm rả với bạn — không phải chuyện lạ.",
    "con-thap-hon":
      "Bố mẹ thấy con hoạt bát hơn con tự thấy. Có thể con vui vẻ ở nhà nhưng đang ngại ở chỗ đông người.",
  },
  S: {
    "con-cao-hon":
      "Con thấy mình nhường nhịn và kiên nhẫn hơn bố mẹ nhìn thấy. Điều con nhường ở ngoài, về nhà chưa chắc kể lại.",
    "con-thap-hon":
      "Bố mẹ thấy con điềm đạm hơn con tự thấy. Bên trong con có thể đang thấy sốt ruột nhiều hơn vẻ ngoài.",
  },
  C: {
    "con-cao-hon":
      "Con thấy mình cẩn thận hơn bố mẹ nhìn thấy. Có thể con kỹ ở việc con quan tâm, còn việc nhà thì không — hai chuyện khác nhau.",
    "con-thap-hon":
      "Bố mẹ thấy con chỉn chu hơn con tự thấy. Con có thể đang khắt khe với chính mình.",
  },
};

export const CHU_DOI_CHIEU = {
  tieuDe: "Hai góc nhìn về {ten}",
  nhanTren: "Vùng lệch",
  /** Nút lùi ở đầu màn. Trước 18.8 chuỗi này gõ cứng thẳng trong JSX. */
  nutQuayLai: "Quay lại",
  cotCon: "Con tự thấy",
  cotBoMe: "Bố mẹ thấy",
  cotLech: "Lệch",
  /** 28.5 — nói bằng CHỮ ai thấy cao hơn và bao nhiêu điểm, để không phải đoán dấu +/−. */
  huongConCao: "Con tự thấy cao hơn bố mẹ thấy {so} điểm",
  huongBoMeCao: "Bố mẹ thấy cao hơn con tự thấy {so} điểm",
  huongGanNhau: "Hai góc nhìn gần nhau",
  /** 🔴 Câu kết BẮT BUỘC ở cuối màn đối chiếu (§8.4). Không được rút gọn. */
  cauKet:
    "Lệch nhau không có nghĩa là ai đó sai. Trẻ hành xử khác nhau ở nhà, ở lớp, ở chỗ bạn bè — và đó chính là thứ bảng này cho thấy. Hãy dùng nó để hỏi con, đừng dùng để kết luận về con.",
  /* ── Khi chưa đủ điều kiện ghép cặp — 🔴 KHÔNG hiện màn hình rỗng ── */
  thieuBaiCon:
    "Còn thiếu bài của con. Để con tự làm {soCau} câu (khoảng {phut} phút) rồi quay lại đây xem hai góc nhìn có khớp nhau không.",
  thieuBaiBoMe:
    "Còn thiếu bài của bố mẹ. Làm {soCau} câu (khoảng {phut} phút) để xem hai góc nhìn có khớp nhau không.",
  khacPhienBan:
    "Hai bài này dùng hai bộ câu hỏi khác nhau nên không đối chiếu được. Làm lại bài cũ để so.",
  quaHan:
    "Hai bài cách nhau quá {soNgay} ngày nên không đối chiếu được — trẻ đổi nhanh, so hai mốc quá xa sẽ ra kết luận sai. Làm lại một trong hai bài để so.",
  nutLamBaiCon: "Đến lượt con",
  nutLamBaiBoMe: "Đến lượt bố mẹ",
} as const;
