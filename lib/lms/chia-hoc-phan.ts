// CHIA GIÁO TRÌNH THÀNH HỌC PHẦN — hàm THUẦN (chủ dự án 29/09/2026).
//
// "Giáo trình được tạo từ khoá học, gán thẳng khoá học, thì khoá học có bao nhiêu học phần thì
// chương trình học có bấy nhiêu học phần, các phần này data phải merge với nhau". Học phần của
// khoá KHÔNG lưu ở khoá: nó là `Lesson.moduleCode` của giáo trình đang dùng — trang khoá học
// (khối Học bù), lượt bù và nhãn buổi đều đọc từ đó. Hàm này là cách DUY NHẤT màn giáo trình
// gán học phần, để hai phía không bao giờ lệch nhau.
//
// Chia ĐỀU theo thứ tự bài; phần dư dồn vào các học phần ĐẦU (48 bài / 4 = 12·12·12·12;
// 50 / 4 = 13·13·12·12). `soHocPhan = 0` ⇒ bỏ chia (mọi bài `null`, cả khoá là một khối).

export const TRAN_SO_HOC_PHAN = 12;

export type GanHocPhan = { order: number; moduleCode: string | null; moduleName: string | null };

export function chiaHocPhan(orders: readonly number[], soHocPhan: number): GanHocPhan[] {
  const theoThuTu = [...orders].sort((a, b) => a - b);
  const n = Math.floor(soHocPhan);
  if (!Number.isFinite(n) || n <= 0 || theoThuTu.length === 0) {
    return theoThuTu.map((order) => ({ order, moduleCode: null, moduleName: null }));
  }
  const k = Math.min(n, theoThuTu.length, TRAN_SO_HOC_PHAN);
  const co = Math.floor(theoThuTu.length / k);
  const du = theoThuTu.length % k;
  const ra: GanHocPhan[] = [];
  let i = 0;
  for (let hp = 1; hp <= k; hp++) {
    const soBai = co + (hp <= du ? 1 : 0);
    for (let j = 0; j < soBai; j++) {
      ra.push({ order: theoThuTu[i++]!, moduleCode: `HP${hp}`, moduleName: `Học phần ${hp}` });
    }
  }
  return ra;
}

/** Tóm tắt học phần hiện có của giáo trình: HP1 → bài 1–12, … (để màn in ra). */
export function tomTatHocPhan(
  bai: readonly { order: number; moduleCode: string | null }[],
): { moduleCode: string; tu: number; den: number; soBai: number }[] {
  const ra = new Map<string, { moduleCode: string; tu: number; den: number; soBai: number }>();
  for (const b of [...bai].sort((x, y) => x.order - y.order)) {
    if (!b.moduleCode) continue;
    const cu = ra.get(b.moduleCode);
    if (cu) {
      cu.den = b.order;
      cu.soBai += 1;
    } else ra.set(b.moduleCode, { moduleCode: b.moduleCode, tu: b.order, den: b.order, soBai: 1 });
  }
  return [...ra.values()];
}

/**
 * Chia theo SỐ BUỔI RIÊNG của từng học phần (chủ dự án 29/09: "tạo số học phần, 1 học phần có bao
 * nhiêu buổi"). `soBuoi[i]` = số buổi của học phần i+1, theo thứ tự bài. Tổng PHẢI bằng số bài —
 * muốn đổi tổng thì đổi số buổi của giáo trình trước (đường có xem trước + chặn mất dữ liệu).
 */
export function chiaHocPhanTheoSo(
  orders: readonly number[],
  soBuoi: readonly number[],
): { ok: true; gan: GanHocPhan[] } | { ok: false; lyDo: string } {
  const theoThuTu = [...orders].sort((a, b) => a - b);
  if (soBuoi.length === 0) {
    return { ok: true, gan: theoThuTu.map((order) => ({ order, moduleCode: null, moduleName: null })) };
  }
  if (soBuoi.length > TRAN_SO_HOC_PHAN) return { ok: false, lyDo: `Tối đa ${TRAN_SO_HOC_PHAN} học phần` };
  if (soBuoi.some((n) => !Number.isInteger(n) || n < 1)) return { ok: false, lyDo: "Mỗi học phần phải có ít nhất 1 buổi" };
  const tong = soBuoi.reduce((s, n) => s + n, 0);
  if (tong !== theoThuTu.length) {
    return {
      ok: false,
      lyDo: `Tổng số buổi các học phần (${tong}) phải bằng số buổi của giáo trình (${theoThuTu.length}) — đổi số buổi giáo trình trước.`,
    };
  }
  const gan: GanHocPhan[] = [];
  let i = 0;
  soBuoi.forEach((n, k) => {
    for (let j = 0; j < n; j++) {
      gan.push({ order: theoThuTu[i++]!, moduleCode: `HP${k + 1}`, moduleName: `Học phần ${k + 1}` });
    }
  });
  return { ok: true, gan };
}
