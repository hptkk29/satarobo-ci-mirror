/**
 * Ô SĐT PHẢI TỰ NÓI KẾT QUẢ TRA CỦA NÓ [15/09/2026].
 *
 * ── Vì sao có file này ──
 * Chủ dự án hỏi: *"đang nhập ở sđt thì lọc theo sđt chứ sao lại lọc xuống dưới khoá học →
 * học viên?"*
 *
 * Đo ra thì việc tra lead theo SĐT VẪN CHẠY: gõ `0910000001` là hiện đúng
 * "Dương Duy Bình · 0910000001 · 1 con: Hoàng Bá Thịnh". Nhưng gõ một SĐT KHÔNG có lead
 * (`930000001` — 0 lead, 1 học viên) thì ô SĐT **im hoàn toàn**: khối gợi ý chỉ được vẽ
 * khi `leadGoiY.length > 0`, còn nhánh rỗng không có gì cả.
 *
 * Hệ quả đúng như câu hỏi: người bán đứng ở ô SĐT, thấy hệ thống KHÔNG phản ứng ở đó, mà
 * phản ứng duy nhất nhìn thấy được ("Đang lọc theo SĐT … — 1 con") lại nằm tận dưới khối
 * Khoá học. Từ chỗ họ đứng, kết luận hợp lý nhất là "bộ lọc đặt nhầm chỗ".
 *
 * Không có lỗi nào nổ, không test nào đỏ, console sạch — đây đúng là luật 12: một ô im
 * lặng là một ô nói dối, vì im lặng có HAI nghĩa (chưa tra / tra rồi mà không có) và người
 * dùng không phân biệt được.
 *
 * ── Vì sao là hàm thuần ──
 * Bốn trạng thái, và chúng phải LOẠI TRỪ NHAU. Viết thẳng vào JSX thì rất dễ có lúc hiện
 * cả spinner lẫn "không tìm thấy", hoặc hiện "không có lead" trong lúc danh sách lead đang
 * bày ngay bên dưới. Tách ra thì cấy lỗi được.
 */

/**
 * Số chữ số tối thiểu mới đi tra.
 *
 * ⚠️ PHẢI KHỚP với cổng ở `timPhuHuynhTheoSdtAction` (server cũng chặn < 6). Lệch nhau
 * thì màn hình hứa "đang tìm" trong khi server không tra gì, hoặc im trong lúc server đã
 * trả kết quả.
 */
export const SO_CHU_SO_TOI_THIEU_TRA_LEAD = 6;

export type TinhTrangTraSdt = {
  /** Số CHỮ SỐ trong ô (đã bỏ mọi ký tự khác). */
  soChuSo: number;
  /** Đang gọi server. */
  dangTra: boolean;
  /** Đã có kết quả cho ĐÚNG số đang gõ (không phải cho số gõ dở trước đó). */
  daTraXong: boolean;
  /** Số lead trả về. */
  soLead: number;
  /** Số hồ sơ học viên khớp SĐT này — dùng để CHỈ ĐƯỜNG xuống ô Học viên. */
  soCon: number;
};

/**
 * Câu cần hiện NGAY DƯỚI ô SĐT. `null` = không nói gì (và đó cũng là một quyết định).
 *
 * Thứ tự nhánh là thứ tự ưu tiên, và nó bảo đảm bốn trạng thái loại trừ nhau:
 *
 *  1. chưa đủ chữ số  → im. Gõ được 3 số mà đã báo "không tìm thấy" là làm ồn vô cớ.
 *  2. đang tra        → nói đang tra, kẻo người bán tưởng hệ thống đứng im.
 *  3. chưa có kết quả cho ĐÚNG số này → im. Đây là khoảnh khắc giữa hai lần gõ; báo
 *     "không có lead" ở đây là báo về số CŨ.
 *  4. có lead         → im. Danh sách lead ngay dưới đã tự nói rồi; thêm một câu nữa là
 *     hai giọng cho một sự việc.
 *  5. KHÔNG có lead   → NÓI RA. Và nếu SĐT đó đã có hồ sơ học viên thì CHỈ ĐƯỜNG xuống ô
 *     Học viên — đúng chỗ người bán đang thắc mắc là "sao lại lọc ở dưới đó".
 */
export function nhacTraLead(tt: TinhTrangTraSdt): string | null {
  if (tt.soChuSo < SO_CHU_SO_TOI_THIEU_TRA_LEAD) return null;
  if (tt.dangTra) return "Đang tìm lead theo số điện thoại…";
  if (!tt.daTraXong) return null;
  if (tt.soLead > 0) return null;
  if (tt.soCon > 0) {
    return (
      `Không có lead nào mang SĐT này, nhưng SĐT này đã có ${tt.soCon} hồ sơ học viên — ` +
      "đã lọc sẵn ở ô Học viên trong phần Khoá học bên dưới."
    );
  }
  return "Không có lead nào mang SĐT này — khách mới, nhập tay các ô còn lại.";
}
