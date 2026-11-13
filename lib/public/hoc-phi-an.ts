// Chữ hiển thị khi website KHÔNG in học phí khoá offline [BLĐ chốt 06/11/2026].
//
// Thuần (không DB) để hàm thuần của trang khoá học và test dùng chung. Cờ bật/tắt đọc ở
// `hoc-phi-an-db.ts`. Cùng một câu cho hai trường hợp "đang ẩn học phí" và "khoá chưa khai
// giá": với phụ huynh cả hai đều là "hỏi trung tâm", và hai câu khác nhau thì sớm muộn lệch.
//
// Câu chữ chủ dự án dặn: ngắn, rõ, không lan man.

/** Nhãn thay cho con số học phí ("880.000đ/tháng"). */
export const NHAN_HOC_PHI_LIEN_HE = "Liên hệ trung tâm";

/** Một dòng giải thích dưới nhãn — vì sao không in giá, và làm gì tiếp. */
export const GHI_CHU_HOC_PHI_LIEN_HE = "Học phí thay đổi theo từng đợt ưu đãi. Gọi hoặc nhắn Zalo để nhận giá mới nhất.";

/**
 * Khoá luyện thi RoboSim ONLINE: thanh toán online, không tại trung tâm ⇒ lý do ẩn của BLĐ
 * không áp dụng, GIỮ giá (chủ dự án chốt 06/11/2026).
 */
export const SLUG_GIU_GIA_ONLINE: ReadonlySet<string> = new Set(["luyenthirobosim"]);
