// lib/payments/ung-vien-ma-khop.ts — trích ỨNG VIÊN `matchKey` từ payload webhook. THUẦN, không DB.
//
// Tách khỏi `payos-ingest.ts` (28/11/2026) để hàng đợi đối soát đơn Online (`lib/online-checkout/tien-ve-don-het-nhan.ts`) dùng ĐÚNG phép tách mà đường tiền vào
// dùng: import ngược `payos-ingest` là thành vòng (`payos-ingest → entitlements/hich → online-checkout/cap-quyen-sau-thanh-toan`). `payos-ingest` xuất lại hàm này nên
// mọi chỗ import cũ giữ nguyên (cùng nếp `sdt-trong-memo.ts`).

/** Ba trường của payload mà phép tách đọc. */
export type NguonUngVienMaKhop = {
  virtualAccountNumber?: string | null;
  reference?: string;
  description?: string;
};

/**
 * Ứng viên `matchKey` lấy từ payload, THEO THỨ TỰ ƯU TIÊN:
 *  1. `virtualAccountNumber` — VA cấp riêng cho phiếu thu (đường bền nhất).
 *  2. `reference` — mã tham chiếu giao dịch.
 *  3. Nội dung chuyển khoản: cả chuỗi, rồi từng token ≥ 6 ký tự (ngân hàng hay
 *     chèn thêm chữ vào nội dung).
 * `matchKey` là @unique nên dò theo danh sách này không sợ đụng nhầm phiếu khác.
 */
export function collectMatchKeyCandidates(data: NguonUngVienMaKhop): string[] {
  const out: string[] = [];
  const push = (v: unknown, min = 4) => {
    if (typeof v !== "string") return;
    const s = v.trim();
    if (s.length >= min) out.push(s);
  };

  push(data.virtualAccountNumber);
  push(data.reference);

  const desc = typeof data.description === "string" ? data.description.trim() : "";
  if (desc) {
    push(desc);
    for (const tok of desc.split(/[^A-Za-z0-9_-]+/)) push(tok, 6);
    // Vòng tách THỨ HAI, rộng hơn — cắt cả `_` và `-` [14/09/2026].
    //
    // VÌ SAO: nội dung CK nay mang `matchKey` lên đầu (lib/payments/noi-dung-ck.ts)
    // để nhánh (a) sống lại. Mã QR nối bằng KHOẢNG TRẮNG nên vòng trên đủ, nhưng
    // phụ huynh GÕ TAY theo bản sale đọc rất hay gõ `ORD260913000001D1_NguyenV` —
    // mà `/[^A-Za-z0-9_-]+/` KHÔNG tách `_`, nên cả cụm ra MỘT token 25 ký tự,
    // không bằng `matchKey` nào, và tiền rơi xuống nhánh đoán y như cũ.
    //
    // An toàn vì `matchKey` là @unique và tra bằng SO BẰNG: thêm ứng viên chỉ tăng
    // cơ hội tìm ĐÚNG khoá; một mảnh tên người muốn khớp nhầm thì phải TRÙNG KHÍT
    // matchKey của phiếu khác. Thêm vòng chứ không SỬA vòng cũ: `virtualAccount`
    // và `reference` của cổng có thể mang `-`/`_` trong chính mã.
    for (const tok of desc.split(/[^A-Za-z0-9]+/)) push(tok, 6);
  }
  return [...new Set(out)];
}
