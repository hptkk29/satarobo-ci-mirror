/**
 * Chia `total` (số tiền nguyên, đồng) theo trọng số `weights` sao cho:
 *  - Mỗi phần là số nguyên ≥ 0.
 *  - **Tổng các phần === total** (bất biến tiền — không mất/thừa 1 đồng do làm tròn).
 *  - Phân bổ theo tỉ lệ `weights`; phần dư (leftover sau khi floor) dồn cho các phần có
 *    số dư nguyên `(total*w) % denom` lớn nhất — thuật Hamilton/largest-remainder,
 *    tie-break theo index nhỏ trước → kết quả ổn định, tái lập.
 *
 * Dùng cho FIN-01 Q1=A: chia 1 khoản Payment của đơn cho nhiều Enrollment theo finalPrice.
 * Nếu Σweights = 0 (vd toàn học bổng / weight rỗng) → chia đều.
 *
 * Toàn bộ dùng số học nguyên (không dựa vào float của phép chia) để tránh lệch làm tròn
 * ở các khoản lớn.
 */
export function allocateByWeight(total: number, weights: number[]): number[] {
  const n = weights.length;
  if (n === 0) return [];
  const t = Math.max(0, Math.round(total));
  if (n === 1) return [t];

  const w = weights.map((x) => (Number.isFinite(x) && x > 0 ? Math.round(x) : 0));
  let denom = w.reduce((s, x) => s + x, 0);
  let weight = w;
  if (denom === 0) {
    // Không có trọng số dương → chia đều.
    weight = weights.map(() => 1);
    denom = n;
  }

  const floors = weight.map((x) => Math.floor((t * x) / denom));
  const remInt = weight.map((x) => (t * x) % denom); // số dư nguyên để xếp hạng
  let leftover = t - floors.reduce((s, f) => s + f, 0); // ∈ [0, n)

  const order = remInt
    .map((r, i) => ({ i, r }))
    .sort((a, b) => b.r - a.r || a.i - b.i);

  const out = floors.slice();
  for (let k = 0; k < order.length && leftover > 0; k++) {
    out[order[k]!.i]! += 1;
    leftover--;
  }
  return out;
}
