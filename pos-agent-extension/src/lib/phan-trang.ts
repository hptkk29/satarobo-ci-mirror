/**
 * Duyệt trang search portal tới khi nhận ĐỦ `total_items` (roadmap §6 GĐ5: page_size 50, lặp hết).
 *
 * Không tin cỡ trang của portal: đếm DÒNG đã nhận. Chặn vòng lặp vô hạn: trang rỗng khi còn
 * thiếu ⇒ THIEU_DONG; quá `toiDaTrang` ⇒ QUA_NHIEU_TRANG; `total_items` sai kiểu ⇒ PORTAL_BAD_SHAPE.
 * Lỗi của `goiTrang` trả NGUYÊN cho nơi gọi (để phân biệt hết phiên / thiếu header / lỗi HTTP).
 * Lỗi ném ra từ `nhanTrang` (gửi lô) KHÔNG bắt ở đây — nơi gọi xử lý.
 *
 * RV5 — TRANG LẶP: portal bỏ qua `page_index` / đánh số khác / trả lại trang cũ ⇒ đếm thô vẫn chạm
 * `total_items` và lượt báo XONG dù thiếu dòng. Nay: một trang KHÔNG RỖNG mà MỌI dòng đều y hệt dòng đã nhận
 * ⇒ THIEU_DONG (không giao lại trang đó). TỰ QUYẾT — cố ý KHÔNG đếm theo `transaction_id` duy nhất: hợp đồng
 * §4.4 tính trước khả năng trùng mã trong dữ liệu thật (master/detail chưa đo) và một dòng mới chèn đầu danh
 * sách giữa hai trang làm trôi một dòng qua biên trang — cả hai là dữ liệu đúng, không được làm lượt hỏng.
 * Cũng KHÔNG chặn theo `meta.page_index` (portal đánh số 0 hay 1 chưa đo — chặn sai là tê liệt mọi lượt).
 */

export type KetQuaTrang<L> = { ok: true; rows: readonly unknown[]; totalItems: unknown } | { ok: false; loi: L };

export type LoiPhanTrang = { ma: "THIEU_DONG" | "QUA_NHIEU_TRANG" | "PORTAL_BAD_SHAPE" };

export type KetQuaDuyet<L> =
  | { ok: true; soDong: number; soTrang: number }
  | { ok: false; loi: L | LoiPhanTrang; soDong: number; soTrang: number };

/** "Dấu" một dòng để nhận ra trang LẶP: cả dòng (đã lọc whitelist ở trang) — chỉ dòng có `transaction_id`. */
function dauDong(x: unknown): string | null {
  if (typeof x !== "object" || x === null || Array.isArray(x)) return null;
  const id = (x as { transaction_id?: unknown }).transaction_id;
  return (typeof id === "string" && id !== "") || typeof id === "number" ? JSON.stringify(x) : null;
}

export async function duyetTrang<L>(
  goiTrang: (pageIndex: number) => Promise<KetQuaTrang<L>>,
  nhanTrang: (rows: readonly unknown[], pageIndex: number) => Promise<void>,
  toiDaTrang: number,
): Promise<KetQuaDuyet<L>> {
  let soDong = 0;
  let soTrang = 0;
  const daThay = new Set<string>();
  for (let pageIndex = 0; ; pageIndex++) {
    if (pageIndex >= toiDaTrang) return { ok: false, loi: { ma: "QUA_NHIEU_TRANG" }, soDong, soTrang };
    const r = await goiTrang(pageIndex);
    if (!r.ok) return { ok: false, loi: r.loi, soDong, soTrang };
    const tong = r.totalItems;
    if (typeof tong !== "number" || !Number.isInteger(tong) || tong < 0 || !Array.isArray(r.rows)) {
      return { ok: false, loi: { ma: "PORTAL_BAD_SHAPE" }, soDong, soTrang };
    }
    soTrang++;
    const dau = r.rows.map(dauDong);
    if (dau.length > 0 && dau.every((d) => d !== null && daThay.has(d))) {
      return { ok: false, loi: { ma: "THIEU_DONG" }, soDong, soTrang };
    }
    for (const d of dau) if (d !== null) daThay.add(d);
    if (r.rows.length > 0) await nhanTrang(r.rows, pageIndex);
    soDong += r.rows.length;
    if (soDong >= tong) return { ok: true, soDong, soTrang };
    if (r.rows.length === 0) return { ok: false, loi: { ma: "THIEU_DONG" }, soDong, soTrang };
  }
}
