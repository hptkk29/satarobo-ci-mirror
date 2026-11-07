// lib/orders/khoan-giam-da-ap.ts — ĐỌC cột JSON `OrderItem.discounts`. THUẦN, không DB.
//
// ─────────────────────────────────────────────────────────────────────────────
// VÌ SAO TÁCH RA [25/09/2026]
//
// Bộ đọc này vốn nằm private trong `order-detail-client.tsx`. Khi thẻ DUYỆT ĐƠN cũng cần
// đọc từng khoản giảm (để nói "dòng nào, bao nhiêu tiền, vì sao"), chỗ rẻ nhất là chép
// nó sang — và đó là cách sinh ra hai bản của một phép đọc phòng thủ. Hai bản thì một
// ngày nào đó một bản biết thêm một trường và bản kia không, trên đúng màn tiền.
//
// ⚠️ ĐỌC PHÒNG THỦ, KHÔNG NÉM. `Json?` của Prisma tới đây là `unknown` và không có kiểu
// nào ép nó: một đơn cũ (cột NULL) hay một hàng sửa tay ở DB không được làm trắng cả
// trang. Trả MẢNG RỖNG khi không hiểu.
//
// ⚠️ Mảng này CHỈ phục vụ phần GIẢI THÍCH. Số tiền ở chân bảng vẫn lấy từ cột Int
// `discountAmount`, nên không có đường nào để nó làm sai một con số tiền.

export type KhoanGiamDaAp = {
  kieu: string;
  giaTri: number;
  phanTram: number | null;
  giam: number;
  /**
   * Giải trình. Với khoản GÕ TAY là chữ người bán nhập; với khoản THEO CHƯƠNG TRÌNH là
   * câu tự sinh `"<mã văn bản> · <mã> — <tên chương trình>"` (xem `lyDoTuMa`).
   * `null` với đơn cũ hoặc hàng dữ liệu thiếu.
   */
  lyDo: string | null;
  /**
   * `Voucher.id` khi khoản đến từ một CHƯƠNG TRÌNH khuyến mãi [28/09/2026].
   *
   * ⚠️ Trường này được GHI từ 28/09 nhưng ban đầu KHÔNG ai đọc lại — `docKhoanGiam` là
   * đường đọc duy nhất của cột JSON ấy, và nó bỏ qua. Cột ghi mà không ai đọc thì tính
   * năng dựng trên nó câm 100% và xanh 100% (cùng bài học với `OrderItem.soBuoi`, ghi
   * trong CLAUDE.md: 0/519 dòng có dữ liệu suốt nhiều tháng).
   *
   * Dùng để PHÂN BIỆT hiển thị: khoản theo chương trình nêu rõ văn bản, khoản gõ tay nêu
   * giải trình của sale. `null` = gõ tay, hoặc đơn tạo trước 28/09.
   */
  voucherId: string | null;
};

export function docKhoanGiam(raw: unknown): KhoanGiamDaAp[] {
  if (!Array.isArray(raw)) return [];
  const ra: KhoanGiamDaAp[] = [];
  for (const r of raw) {
    if (!r || typeof r !== "object") continue;
    const o = r as Record<string, unknown>;
    if (typeof o.giam !== "number") continue;
    ra.push({
      kieu: typeof o.kieu === "string" ? o.kieu : "SO_TIEN",
      giaTri: typeof o.giaTri === "number" ? o.giaTri : 0,
      phanTram: typeof o.phanTram === "number" ? o.phanTram : null,
      giam: o.giam,
      lyDo: typeof o.lyDo === "string" && o.lyDo.trim() ? o.lyDo : null,
      voucherId:
        typeof o.voucherId === "string" && o.voucherId.trim() ? o.voucherId : null,
    });
  }
  return ra;
}

/** Một khoản giảm ĐÃ GẮN với dòng hàng của nó — thứ màn duyệt cần để nói đủ BỐN vế. */
export type KhoanGiamCuaDong = KhoanGiamDaAp & {
  /** `OrderItem.itemName` — nhãn KHOÁ/SẢN PHẨM. KHÔNG phải tên bé. */
  tenDong: string;
  /**
   * Tên bé của dòng, `null` khi chưa gắn được [25/09/2026].
   *
   * ⚠️ Vế thứ TƯ, và là vế chủ dự án hỏi: *"giải trình như thế này thì 2 con học cùng
   * khoá thì sao biết là đang giảm đơn cho con nào?"* Trên `/orders/new`, `itemName` là
   * tên KHOÁ, nên hai con cùng khoá cho ra hai dòng giải trình mở đầu bằng CÙNG một
   * chuỗi — người duyệt gật một khoản tiền mà không biết nó của đứa trẻ nào.
   */
  tenCon: string | null;
};

/**
 * Mọi khoản giảm của cả đơn, KÈM tên dòng.
 *
 * ⚠️ Dùng cho màn DUYỆT. Người duyệt cần ba vế cho mỗi khoản: **dòng nào · bao nhiêu
 * tiền · vì sao**. Trước 25/09 màn ấy đọc `Order.discountReason` — một chuỗi GỘP sẵn lúc
 * ghi (`"Dòng 1: aaaa · Dòng 1: bbbbb"`) nên nó mất hẳn vế SỐ TIỀN. Chủ dự án nói thẳng:
 * *"giải trình dòng nào, bao nhiêu tiền thì ghi rõ ra"*.
 *
 * Duyệt một khoản tiền mà không thấy số tiền thì chữ "duyệt" không có nghĩa gì.
 */
export function khoanGiamCuaDon(
  items: readonly { itemName: string; discounts: unknown; tenCon: string | null }[],
): KhoanGiamCuaDong[] {
  const ra: KhoanGiamCuaDong[] = [];
  for (const it of items) {
    for (const k of docKhoanGiam(it.discounts)) {
      // ⚠️ `tenCon` khai BẮT BUỘC, cố ý không cho `?` (luật 7). Tuỳ chọn ở đây là một lỗi
      // CÂM: chỗ gọi quên truyền thì mọi khoản mất danh tính bé, không lỗi biên dịch,
      // không ca nào đỏ, và màn duyệt lặng lẽ quay về đúng trạng thái vừa vá.
      if (k.giam > 0) ra.push({ ...k, tenDong: it.itemName, tenCon: it.tenCon?.trim() || null });
    }
  }
  return ra;
}
