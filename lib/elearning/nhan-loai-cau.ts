/**
 * NHÃN LOẠI CÂU HỎI — một bảng cho mọi màn (báo cáo kết quả thi, ngân hàng câu hỏi…). THUẦN, không đổi luật nào: chỉ nói tên loại bằng chữ người đọc.
 * Nhãn theo thiết kế 20/11 ("Chọn một", "Chọn nhiều", "Ghép cặp", "Nhập số", "Tự luận"…). Loại ngoài bảng ⇒ rơi về mã gốc (không bịa nhãn).
 *
 * ⚠️ KHÔNG phải cổng: loại nào được vào đề là `duocVaoDe` (exam-grading.ts) — loại có nhãn ở đây vẫn có thể CHƯA mở.
 */
export const NHAN_LOAI_CAU: Readonly<Record<string, string>> = {
  SINGLE: "Chọn một",
  MULTIPLE: "Chọn nhiều",
  TRUE_FALSE: "Đúng / Sai",
  FILL_BLANK: "Điền chỗ trống",
  MATCHING: "Ghép cặp",
  ORDERING: "Sắp xếp thứ tự",
  SHORT_ANSWER: "Trả lời ngắn",
  CASE: "Tình huống",
  ESSAY: "Tự luận",
  CLASSIFY: "Phân loại",
  IMAGE_HOTSPOT: "Chọn trên hình",
  NUMERIC: "Nhập số",
  PRODUCT: "Sản phẩm",
  BLOCK_SEQUENCE: "Xếp khối lệnh",
};

export function nhanLoaiCau(type: string): string {
  return NHAN_LOAI_CAU[type] ?? type;
}
