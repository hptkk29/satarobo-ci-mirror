/**
 * HỌC VIÊN CÓ ĐƯỢC HỌC BUỔI NÀY KHÔNG — hàm THUẦN, không DB.
 *
 * Chủ dự án chốt 28/09/2026: *"đăng ký 39 buổi thì sẽ bắt đầu học từ buổi 10 → 48, để khi
 * thêm vào lớp học thì chỉ được học và điểm danh từ buổi 10 → 48, các buổi không đăng ký
 * thì bỏ qua"*.
 *
 * Phạm vi buổi tính ở `./dot-theo-hoc-phan` (`phamViBuoiDangKy`) lúc GHI DANH và lưu vào
 * `Enrollment.buoiBatDau`. Tệp này chỉ trả lời câu hỏi lúc ĐỌC.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ⚠️ SO VỚI SỐ BUỔI THEO **LỘ TRÌNH**, KHÔNG PHẢI THEO LỊCH.
 *
 * `lib/lms/session-order.ts` tách hai con số, và sự cố 07/09 sinh ra từ việc gộp chúng:
 *   · `soBuoiTheoLoTrinh` — bài thứ mấy của GIÁO TRÌNH (dùng in nhãn, và dùng ở đây);
 *   · `soBuoiTheoLich`    — buổi thứ mấy theo NGÀY (dùng sắp xếp).
 *
 * Phải là lộ trình: "đăng ký từ buổi 10" nghĩa là **bài số 10 của giáo trình**. Lớp dời
 * lịch một buổi (đã xảy ra thật ở `CS2.SATA6.26.001`, 6 buổi bị dời ngày) thì số theo
 * LỊCH đổi còn số theo lộ trình giữ nguyên — dùng nhầm là học viên bỗng được/mất quyền
 * học một buổi chỉ vì lớp đổi ngày.
 *
 * ⚠️ FAIL-OPEN CÓ CHỦ ĐÍCH, và phải hiểu đúng vì sao.
 *
 * `buoiBatDau = null` ⇒ **được học mọi buổi**. Đó là trạng thái của 100% ghi danh có
 * trước 28/09/2026 (cột mới, không backfill). Fail-closed ở đây nghĩa là **mọi học viên
 * đang học biến mất khỏi mọi bảng điểm danh** ngay hôm triển khai — hỏng to hơn hẳn lỗ nó
 * định bịt, và hỏng với những người KHÔNG liên quan tới tính năng này.
 *
 * `soBuoiLoTrinh = null` (lớp chưa ghim giáo trình, không suy được bài số mấy) cũng
 * fail-open: không biết buổi này là bài mấy thì không có cơ sở để từ chối ai.
 */

export type XetBuoiDuocHoc = {
  duocHoc: boolean;
  /** `true` khi không đủ dữ liệu để xét — dùng cho nhãn, đừng dùng làm cổng. */
  khongXet: boolean;
};

/**
 * Một học viên có nằm trong phạm vi buổi đã đăng ký không.
 *
 * ⚠️ HAI THAM SỐ BẮT BUỘC, không mặc định (luật 7). Mặc định `buoiBatDau = null` ở đây là
 * fail-open ÂM THẦM: chỗ gọi nào quên `select: { buoiBatDau: true }` sẽ nhận `undefined`,
 * cổng cho qua tất, và **không lỗi nào báo** — đúng lớp lỗi câm mà cột `soBuoi` đã mắc
 * (0/519 dòng có dữ liệu suốt nhiều tháng). Bắt buộc khai để `tsc` liệt kê chỗ gọi.
 */
export function xetBuoiDuocHoc(d: {
  /** `Enrollment.buoiBatDau` — `null` = đăng ký đủ khoá (hoặc dòng cũ chưa có dữ liệu). */
  buoiBatDau: number | null;
  /** `soBuoiTheoLoTrinh(...)` của buổi đang xét — `null` khi lớp chưa ghim giáo trình. */
  soBuoiLoTrinh: number | null;
}): XetBuoiDuocHoc {
  if (d.buoiBatDau === null || !Number.isInteger(d.buoiBatDau) || d.buoiBatDau <= 1) {
    // `<= 1` gộp luôn ca "đăng ký từ buổi 1" = đủ khoá: không cần xét gì thêm.
    return { duocHoc: true, khongXet: false };
  }
  if (d.soBuoiLoTrinh === null || !Number.isInteger(d.soBuoiLoTrinh)) {
    return { duocHoc: true, khongXet: true };
  }
  return { duocHoc: d.soBuoiLoTrinh >= d.buoiBatDau, khongXet: false };
}

/**
 * Nhãn cho ô "chưa tới lượt học" trên bảng điểm danh.
 *
 * 🔴 PHẦN BẮT BUỘC, KHÔNG PHẢI TRANG TRÍ (luật 12 — affordance phải nói thật). Ẩn trắng
 * học viên khỏi bảng là để giáo viên tự đoán vì sao thiếu người: họ sẽ nghĩ hệ thống lỗi,
 * hoặc tệ hơn, nghĩ em đó đã nghỉ học. Hiện tên kèm lý do thì không ai phải đoán.
 */
export function nhanChuaToiLuot(d: { buoiBatDau: number }): string {
  return `Đăng ký từ buổi ${d.buoiBatDau}`;
}
