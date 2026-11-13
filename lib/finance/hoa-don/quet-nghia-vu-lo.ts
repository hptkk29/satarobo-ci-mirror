// lib/finance/hoa-don/quet-nghia-vu-lo.ts — chọn LÔ đơn cho mỗi lượt quét của scanner bóng (Invoice Hub S8). THUẦN.
//
// Scanner KHÔNG lưu con trỏ: một con trỏ là một trạng thái phải sống sót qua cron lỡ / chạy chồng / chết giữa chừng. Thay vào đó mỗi lượt chọn lô
// chỉ từ (danh sách ứng viên đã sắp, TICK = ô 10 phút của đồng hồ) — một cửa sổ XOAY: lượt t lấy `kichCo` phần tử bắt đầu ở `t·kichCo (mod n)`.
// Hệ quả: `ceil(n / kichCo)` lượt liên tiếp phủ HẾT mọi ứng viên; lỡ một lượt thì đơn đó chậm thêm một vòng, không mất. (ADR §7.3 "con trỏ an toàn"
// nói cửa sổ chồng lấn; bản này đổi con trỏ lưu bằng vòng xoay tất định — cùng mục đích, ít trạng thái hơn.)

/** Cron chạy 10 phút một lần (`deploy/crontab.example`, `vercel.json`). */
export const BUOC_TICK_PHUT = 10;

/** Ô thời gian hiện tại — số nguyên tăng dần mỗi `BUOC_TICK_PHUT` phút. Hàm của `now` truyền vào, không đọc đồng hồ. */
export function tickCua(now: Date): number {
  return Math.floor(now.getTime() / (BUOC_TICK_PHUT * 60_000));
}

/**
 * Lô `kichCo` phần tử của danh sách ứng viên ở lượt `tick`. Ứng viên được loại trùng và sắp theo chuỗi (không phụ thuộc thứ tự người gọi đưa vào).
 * n ≤ kichCo ⇒ lấy hết. `kichCo ≤ 0` ⇒ rỗng.
 */
export function chonLo(ungVien: readonly string[], tick: number, kichCo: number): string[] {
  if (!(kichCo > 0)) return [];
  const ds = [...new Set(ungVien)].sort();
  const n = ds.length;
  if (n <= kichCo) return ds;
  const batDau = (((tick * kichCo) % n) + n) % n;
  const lo: string[] = [];
  for (let i = 0; i < kichCo; i++) lo.push(ds[(batDau + i) % n]!);
  return lo;
}

/** Gộp các tầng (đã chọn lô riêng) theo thứ tự ưu tiên: bỏ trùng, giữ thứ tự, cắt ở `tran`. */
export function gopLo(tang: readonly (readonly string[])[], tran: number): string[] {
  const thay = new Set<string>();
  for (const t of tang) {
    for (const id of t) {
      if (thay.size >= tran) return [...thay];
      thay.add(id);
    }
  }
  return [...thay];
}

/** Tổng đơn tối đa mỗi lượt và phần dành cho từng tầng. Một đơn ≈ vài câu tra; trần giữ lượt dưới ngân sách `maxDuration` của cron. */
export const TRAN_DON_MOI_LUOT = 60;
export const CO_LO = { thayDoi: 40, chuaOnDinh: 10, quetVong: 10 } as const;

/** Ba tầng ứng viên (đã đọc từ DB): đơn mới đổi · đơn có dòng chiếu chưa ổn định quá hạn · đơn quét vòng (chưa có dòng / phát hiện trôi). */
export type UngVienQuet = { thayDoi: string[]; chuaOnDinh: string[]; quetVong: string[] };

/**
 * Lô của lượt `tick`: mỗi tầng xoay vòng riêng trong phần của nó, gộp theo ưu tiên (thay đổi → chưa ổn định → quét vòng), bỏ trùng, trần `TRAN_DON_MOI_LUOT`.
 * Phần quota không dùng hết của một tầng KHÔNG chuyển cho tầng khác — tầng quét vòng không được ăn chỗ của đơn mới đổi.
 */
export function ghepLoTheoTang(u: UngVienQuet, tick: number): string[] {
  return gopLo(
    [chonLo(u.thayDoi, tick, CO_LO.thayDoi), chonLo(u.chuaOnDinh, tick, CO_LO.chuaOnDinh), chonLo(u.quetVong, tick, CO_LO.quetVong)],
    TRAN_DON_MOI_LUOT,
  );
}
