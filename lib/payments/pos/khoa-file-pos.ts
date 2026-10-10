// lib/payments/pos/khoa-file-pos.ts — KHOÁ nhận ra "cùng một file" cho nút "Tiếp tục từ lô x/y".
// THUẦN, chạy trong trình duyệt (màn import) — không import gì của server.
//
// ⚠️ Rà vòng 3 (30/09/2026, ca `[POS-KF-*]`): bản trước khoá bằng tên + số dòng + số lô + mã giao
// dịch ĐẦU/CUỐI. Bản xuất lại cùng ngày từ SmartPOS (cùng tên, cùng số dòng, cùng mã đầu/cuối) mà
// vài dòng ở GIỮA đổi cột — `Trạng thái Hoàn/Hủy` (tín hiệu hủy toàn phần!), cột kết toán — vẫn
// ra cùng khoá ⇒ màn "tiếp tục từ lô k" và thay đổi ở lô 1..k-1 KHÔNG BAO GIỜ lên server, không ai
// báo. Nay khoá mang một phép băm của TOÀN BỘ nội dung các dòng đã đọc: đổi một ô là lượt mới.

import type { DongPos } from "./kieu";

/** FNV-1a 32-bit — đủ để phân biệt hai bản xuất; không dùng cho bảo mật. */
function fnv1a(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

export function khoaFilePos(tenFile: string, dong: readonly DongPos[], soLo: number): string {
  return `${tenFile}|${dong.length}|${soLo}|${fnv1a(JSON.stringify(dong))}`;
}
