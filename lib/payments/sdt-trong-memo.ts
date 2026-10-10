// lib/payments/sdt-trong-memo.ts — BÓC SỐ ĐIỆN THOẠI KHỎI NỘI DUNG CK. Thuần.
//
// ─────────────────────────────────────────────────────────────────────────────
// TÁCH RA KHỎI `payos-ingest.ts` ngày 17/09/2026, và lý do là một ràng buộc THẬT chứ không
// phải gu kiến trúc: `payos-ingest.ts` mở đầu bằng `import "server-only"`, nên MỌI script
// chạy ngoài Next (`tsx scripts/...`) đều chết với `Cannot find module 'server-only'` khi
// chạm tới nó. Đã đo.
//
// Báo cáo đối soát chạy trên prod là một script như thế. Nó cần đúng phép bóc SĐT mà tầng
// đối khớp dùng — và cách duy nhất còn lại nếu không tách là **chép một bản thứ hai**. Bản
// thứ hai của luật đối khớp tiền là thứ repo này đã trả giá nhiều lần: hai nơi quyết định
// cùng một chuyện, rồi lệch nhau âm thầm.
//
// ⚠️ KHÔNG đổi một dòng logic nào khi tách. `payos-ingest.ts` xuất lại hai hàm này nên mọi
// đường gọi và mọi ca test cũ giữ nguyên chỗ import.
import { canonicalPhone } from "@/lib/phone";

/**
 * Bóc SĐT phụ huynh ra khỏi nội dung CK (THUẦN).
 *
 * 20/08 — nội dung CK đổi sang dạng người đọc `HoTenCon_SdtPH_TenKhoa`, nên SĐT
 * trở thành đường đối khớp. Nhận `84XXXXXXXXX` (11 số) và `0XXXXXXXXX` (10 số),
 * trả canonical `84XXXXXXXXX`.
 *
 * ⚠️ Hai vòng dò, KHÔNG gộp làm một:
 *  1. Theo BIÊN TOKEN (tách ở mọi ký tự không phải số) — đây là ca thường, và nó
 *     không thể cắt bừa giữa hai cụm số dính nhau.
 *  2. Chỉ khi (1) trượt mới quét cửa sổ trượt trên chuỗi số ĐÃ GỘP: có ngân hàng
 *     dán số tiền/mã tham chiếu dính liền SĐT.
 * Cửa sổ 11 dò trước 10 để "84…" không bị đọc nhầm thành mảnh của số khác.
 *
 * KHÔNG nhận dạng 9 số trần (Excel nuốt số 0) như `canonicalPhone`: quét chuỗi tự
 * do mà nhận 9 số thì mọi số tài khoản đều thành "SĐT".
 */
export function extractVnPhoneCandidates(content: string | null | undefined): string[] {
  // ⚠️ GỠ MÃ ĐƠN TRƯỚC KHI DÒ. `ORD260820000001` là 12 chữ số dính liền nhau, và
  // cửa sổ trượt ở vòng (2) đẻ ra "SĐT" hợp lệ GIẢ từ chính nó — đo được:
  // "ORD260820000001D1" → 84820000001. Mã đơn đã có nhánh (c) lo, ở đây nó chỉ là
  // rác gây nhiễu.
  const raw = String(content ?? "").replace(/ORD[\s.\-_]*\d{6}[\s.\-_]*\d{6}/gi, " ");
  if (!raw) return [];

  const out: string[] = [];
  const push = (hit: string | null) => {
    if (hit && !out.includes(hit)) out.push(hit);
  };

  for (const token of raw.split(/[^0-9]+/)) push(phoneFromDigits(token));
  // ⚠️ Cửa sổ trượt CHỈ chạy khi vòng token trắng tay — giữ nguyên ngữ nghĩa cũ.
  // Chạy luôn cả hai vòng thì mọi nội dung "sạch" cũng đẻ thêm số ứng viên rác từ
  // các cụm số dính nhau, mà từ 20/08 nhiều ứng viên = NHẬP NHẰNG = không rót ⇒
  // ta tự tay biến ca đang chạy tốt thành đối soát tay.
  if (out.length === 0) {
    const digits = raw.replace(/\D/g, "");
    for (const len of [11, 10]) {
      for (let i = 0; i + len <= digits.length; i++) {
        push(phoneFromDigits(digits.slice(i, i + len)));
      }
    }
  }
  // Trần an toàn: nội dung có 6 số điện thoại là rác/quảng cáo, đã chắc chắn phải
  // xử lý tay — không cần dò DB cho từng số.
  return out.slice(0, 5);
}

/**
 * Bản 1-số giữ cho đường gọi cũ (test hồi quy, log). ⚠️ ĐỪNG dùng nó cho việc
 * ĐỐI KHỚP: lấy số đầu tiên chính là con bug "bà ngoại chuyển hộ" — ngân hàng ghi
 * "CT tu 0912345678 NGUYEN THI B chuyen tien TranMinhAnh_84905111222_Sata2" thì số
 * đầu tiên là số NGƯỜI GỬI, không phải phụ huynh. Đối khớp dùng
 * `extractVnPhoneCandidates` + bằng chứng phụ (tên con / tên khoá).
 */
export function extractVnPhone(content: string | null | undefined): string | null {
  return extractVnPhoneCandidates(content)[0] ?? null;
}

/** Chỉ đúng 2 dạng người ta gõ vào nội dung CK; chuẩn hoá vẫn nhờ lib/phone.ts. */
function phoneFromDigits(digits: string): string | null {
  if (digits.length === 11 && digits.startsWith("84")) return canonicalPhone(digits);
  if (digits.length === 10 && digits.startsWith("0")) return canonicalPhone(digits);
  return null;
}
