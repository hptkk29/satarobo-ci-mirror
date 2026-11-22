/**
 * lib/nguon/nhan-duong-vao.ts — TÊN HIỂN THỊ của «đường vào» (`Lead.source`, khoá kỹ thuật). THUẦN.
 *
 * `Lead.source` là khoá định tuyến kỹ thuật (đường mà phiếu đi vào), KHÔNG phải nguồn nghiệp vụ — nguồn nghiệp vụ nằm ở `LeadAttribution.group` (module Nguồn).
 * Màn hình ưu tiên hiện TÊN NGUỒN; chỉ khi chưa có quy nguồn mới rơi về đường vào, và khi đó gọi nó bằng tên NGƯỜI DÙNG hiểu.
 *
 * Chủ dự án chốt 29/10/2026: đường vào cũ `sale-form-app` (tên từ thời site Sale) hiện là `nhap-khach-hang` — đúng tên màn nhập khách đang dùng.
 * CHỈ ĐỔI CHỮ HIỂN THỊ: giá trị lưu trong DB, `DUONG_VAO_MAC_DINH`, bảng ánh xạ nhãn cũ và các lưới theo khoá `sale-form-app` KHÔNG đổi (đổi khoá lưu là cắt đôi lịch sử báo cáo).
 */
const TEN_HIEN_THI: Readonly<Record<string, string>> = {
  "sale-form-app": "nhap-khach-hang",
};

/** Tên hiển thị của một đường vào; rỗng/null ⇒ null; không có trong bảng ⇒ giữ nguyên (đã cắt khoảng trắng đầu/cuối). */
export function nhanDuongVao(raw: string | null | undefined): string | null {
  const s = typeof raw === "string" ? raw.trim() : "";
  if (s === "") return null;
  return Object.prototype.hasOwnProperty.call(TEN_HIEN_THI, s) ? TEN_HIEN_THI[s]! : s;
}

function rutGonDuongVao(source: string): string {
  return source.split(" - ").slice(0, 2).join(" · ");
}

/**
 * Chữ hiện ở ô NGUỒN của danh sách lead (chủ dự án 29/10/2026): ưu tiên TÊN NGUỒN (quy nguồn); chưa quy nguồn mới rơi về đường vào, gọi bằng tên hiển thị.
 * MỘT hàm cho cả hai chỗ in (dòng dưới «Khoá quan tâm» và cột «Nguồn») để hai nơi không lệch nhau. Thuần — để test không phải nạp cả màn hình.
 */
export function chuNguonCuaLead(lead: { nguonTen?: string | null; source: string | null }): string | null {
  const ten = lead.nguonTen?.trim();
  if (ten) return ten;
  const duongVao = nhanDuongVao(lead.source);
  return duongVao ? rutGonDuongVao(duongVao) : null;
}
