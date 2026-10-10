/**
 * HẰNG ĐO LƯỜNG của module đào tạo nội bộ — ĐÓNG BĂNG.
 *
 * ⚠️ Đây là NƠI CHỐT DUY NHẤT của các con số này. Phần 3, Phần 4 và Phần 7 của kế
 * hoạch đều trích lại chúng; không phần nào tự đặt số, và không ai chốt lại bằng
 * lời. Đổi một con số ở đây = PR + review + `AuditLog`.
 *
 * ⚠️ KHÔNG khai chúng ở cấu hình khoá, KHÔNG dựng màn hình sửa. Một hằng đo lường
 * mà sửa được từ giao diện thì mọi chỉ số lịch sử tính bằng nó trở thành không so
 * sánh được với nhau, và không ai biết kỳ nào dùng số nào.
 */

/**
 * Hạn CHẤM TAY một lượt nộp: 3 NGÀY LÀM VIỆC kể từ lúc nộp.
 *
 * Vì sao 3 chứ không phải 5: `NSM_MAX_DUE_DAYS = 14` là TOÀN BỘ cửa sổ từ lúc giao
 * tới hạn hoàn thành. 5 ngày làm việc = 7 ngày lịch = **một nửa cửa sổ**, tức SLA
 * chấm và hạn của người học mâu thuẫn nhau ngay từ định nghĩa. 3 ngày làm việc = 5
 * ngày lịch, còn lại 9 ngày cho người học sửa và nộp lại (ngưỡng đạt 80/100 nên có
 * nộp lại).
 *
 * Khối lượng công việc KHÔNG đổi theo SLA: 24 giờ chấm/năm là **thể tích**, không
 * phải tốc độ. Siết SLA không làm ai phải chấm nhiều hơn.
 */
export const SLA_GRADE_DAYS = 3;

/**
 * Toàn bộ cửa sổ từ lúc giao bài tới hạn hoàn thành, tính bằng NGÀY LỊCH.
 *
 * Ghi ở đây để ràng buộc "SLA chấm phải NHỎ HƠN cửa sổ này" kiểm được bằng test,
 * thay vì là một câu trong tài liệu mà không ai đối chiếu.
 */
export const NSM_MAX_DUE_DAYS = 14;

/**
 * Ngưỡng cảnh báo tồn đọng hàng đợi chấm (M10): tuổi bài chờ lâu nhất vượt 2× SLA.
 *
 * ⚠️ Hàng đợi chấm tay vỡ SLA là MỘT trong hai dấu hiệu sớm của rủi ro điểm đơn lẻ
 * ở phòng Đào tạo (QĐ-CDA-15) — phòng có 4/15 nhân sự mà gánh cả ba vai. Dấu hiệu
 * còn lại là M12 "số khoá xuất bản mỗi tháng" rơi 0 hai kỳ liên tiếp. Cả hai là
 * triệu chứng của CÙNG một nguyên nhân là quá tải, và cả hai xuất hiện TRƯỚC khi hệ
 * thống có vẻ hỏng — chờ tới lúc có người kêu là đã muộn một quý.
 */
export const CANH_BAO_TUOI_CHO_NGAY_LAM = SLA_GRADE_DAYS * 2;

/** Ngưỡng cảnh báo M10 theo SỐ BÀI quá hạn chấm. */
export const CANH_BAO_SO_BAI_QUA_SLA = 3;
