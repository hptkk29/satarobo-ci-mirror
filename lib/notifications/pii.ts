// lib/notifications/pii.ts — chốt chặn dữ liệu nhạy cảm trong tiêu đề/nội dung thông báo.
//
// PRD xếp T5 ("SĐT phụ huynh, thông tin học phí lọt vào dòng xem trước") là rủi ro CHẶN PHÁT HÀNH.
// Lý do không phải kỹ thuật: dòng xem trước hiện ở panel chuông, mà panel thì mở giữa lớp học, giữa
// buổi tư vấn, trên màn hình có người khác nhìn thấy. Nội dung đầy đủ chỉ được xem sau khi vào màn
// đích — nơi có kiểm quyền thật.
//
// THUẦN — test bằng Vitest, không cần gì.

/**
 * Số điện thoại Việt Nam trong văn bản tự do.
 *
 * Bắt cả 3 dạng đang có trong DB (`0818823720`, `84818823720`, `+84 818 823 720`) và chấp nhận
 * dấu cách/chấm/gạch xen giữa. KHÔNG dùng `\b`: `\b` không khớp khi ký tự trước là chữ số, nên
 * "SĐT0818823720" sẽ lọt.
 *
 * Hai lookaround là bắt buộc, không phải cho đẹp: thiếu chúng thì mã đơn 13 chữ số
 * ("2026081900123") bị nhận là SĐT — và vì hàm `cheSdt` có QUYỀN SỬA nội dung, nhận nhầm nghĩa là
 * bôi đen mã đơn thật trong thông báo gửi kế toán.
 */
const SDT = /(?<!\d)(?:\+?84|0)(?:[\s.-]?\d){9}(?!\d)/g;

/**
 * Số tiền: chuỗi ≥ 4 chữ số có phân tách nghìn, hoặc số kèm đơn vị tiền.
 * Không bắt số trần (vd "8 học viên", "buổi 12") — bắt hết thì mọi thông báo đếm việc đều báo động.
 */
const TIEN = /\d{1,3}(?:[.,]\d{3}){1,}\s*(?:đ|vnđ|vnd|₫)?|\d+\s*(?:đ|vnđ|vnd|₫)(?![a-zA-ZÀ-ỹ])/gi;

export interface KetQuaKiemPii {
  coSdt: boolean;
  coTien: boolean;
}

/** Soi một chuỗi. Dùng cho test và cho cảnh báo lúc chạy. */
export function kiemPii(text: string): KetQuaKiemPii {
  return {
    coSdt: new RegExp(SDT.source, SDT.flags).test(text),
    coTien: new RegExp(TIEN.source, TIEN.flags).test(text),
  };
}

/**
 * Che số điện thoại, giữ 3 số cuối để người nhận vẫn nhận ra là ai nếu cần.
 *
 * CHỈ che SĐT, KHÔNG che số tiền — dù PRD gộp chung hai thứ. Lý do: nhiều thông báo cho kế toán
 * (đối soát ngân hàng, công nợ quá hạn) mang con số là NỘI DUNG CHÍNH của việc; che đi thì thông
 * báo mất nghĩa, và người nhận vốn đã là người có quyền xem tiền. Số tiền chỉ bị CẢNH BÁO trong
 * log để rà lại nếu một loại thông báo mới vô tình mang học phí của một học viên cụ thể ra panel.
 */
export function cheSdt(text: string): string {
  return text.replace(SDT, (m) => {
    const so = m.replace(/\D/g, "");
    return so.length >= 3 ? `***${so.slice(-3)}` : "***";
  });
}
