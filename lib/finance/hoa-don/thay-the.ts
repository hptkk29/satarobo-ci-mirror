// lib/finance/hoa-don/thay-the.ts — hoá đơn KẾ TIẾP thay cho bản ĐÃ HUỶ nào. THUẦN.
//
// Quyết định (1) 27/09: hoá đơn sai thì HUỶ (DA_XAC_NHAN → THAY_THE, khoản về hàng chờ); bản đúng tải
// lên theo luồng THƯỜNG, và hệ thống TỰ nối `thayTheChoId` về bản đã huỷ. Nối ở đây, đọc từ DB lúc
// tạo — KHÔNG bao giờ nhận id từ client (client chọn được thì nối nhầm sang hoá đơn đơn khác được).
//
// Luật (một chỗ):
//   1. Với MỖI khoản của bản mới, "bản đã huỷ gần nhất từng giữ nó" = bản THAY_THE (cùng đơn, dòng nối
//      hieuLuc=false) có `huyLuc` LỚN NHẤT. Nhờ "gần nhất theo từng khoản" mà chuỗi A→B→C nối C về B,
//      không về A.
//   2. Mỗi khoản BẦU cho bản đó. Khoản chưa từng nằm trong hoá đơn nào bị huỷ (tiền mới) không bầu.
//   3. Bản được nhiều phiếu nhất thắng; hoà ⇒ bản huỷ MUỘN hơn; hoà tiếp ⇒ id lớn hơn (ổn định).
//   4. Không phiếu nào ⇒ null (bản mới không thay cho ai).

export type HoaDonDaHuyVao = { id: string; huyLuc: Date | null; paymentIds: readonly string[] };

/** > 0 khi `a` huỷ MUỘN hơn `b` (null = xa nhất); hoà giờ thì so id — thứ tự luôn xác định. */
function moiHon(a: HoaDonDaHuyVao, b: HoaDonDaHuyVao): number {
  const ta = a.huyLuc?.getTime() ?? Number.NEGATIVE_INFINITY;
  const tb = b.huyLuc?.getTime() ?? Number.NEGATIVE_INFINITY;
  if (ta !== tb) return ta > tb ? 1 : -1;
  return a.id === b.id ? 0 : a.id > b.id ? 1 : -1;
}

/** Mỗi khoản ⇒ hoá đơn ĐÃ HUỶ GẦN NHẤT từng giữ nó. */
export function huyGanNhatTheoKhoan<T extends HoaDonDaHuyVao>(daHuy: readonly T[]): Map<string, T> {
  const m = new Map<string, T>();
  for (const h of daHuy) {
    for (const p of h.paymentIds) {
      const cu = m.get(p);
      if (!cu || moiHon(h, cu) > 0) m.set(p, h);
    }
  }
  return m;
}

/** Bản kế tiếp phủ `khoanIds` thay cho bản đã huỷ nào. `null` ⇔ không khoản nào từng nằm trong hoá đơn bị huỷ. */
export function chonHoaDonDuocThay(daHuy: readonly HoaDonDaHuyVao[], khoanIds: readonly string[]): string | null {
  const gan = huyGanNhatTheoKhoan(daHuy);
  const phieu = new Map<string, { h: HoaDonDaHuyVao; n: number }>();
  for (const p of new Set(khoanIds)) {
    const h = gan.get(p);
    if (!h) continue;
    phieu.set(h.id, { h, n: (phieu.get(h.id)?.n ?? 0) + 1 });
  }
  let tot: { h: HoaDonDaHuyVao; n: number } | null = null;
  for (const v of phieu.values()) {
    if (!tot || v.n > tot.n || (v.n === tot.n && moiHon(v.h, tot.h) > 0)) tot = v;
  }
  return tot?.h.id ?? null;
}

/** Các bản đã huỷ "đứng ngay trước" một lần thu — mỗi bản một lần, bản huỷ MUỘN nhất trước. */
export function hoaDonDaHuyCuaLanThu<T extends HoaDonDaHuyVao>(daHuy: readonly T[], khoanIds: readonly string[]): T[] {
  const gan = huyGanNhatTheoKhoan(daHuy);
  const ra = new Map<string, T>();
  for (const p of khoanIds) {
    const h = gan.get(p);
    if (h) ra.set(h.id, h);
  }
  return [...ra.values()].sort((a, b) => moiHon(b, a));
}
