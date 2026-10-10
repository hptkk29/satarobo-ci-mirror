// lib/cham-cong/luoi-phan-ca.ts — phần THUẦN của lưới phân ca (dùng được ở client).
//
// Màn `/cham-cong/phan-ca` (MonthGrid) và tệp Excel cùng đếm cột Công/Nghỉ ở ĐÂY — hai bên
// lệch nhau là kế toán đối chiếu file với màn ra hai số.

/**
 * K-01 (luật Sheet): mọi mã làm việc = 1 công; X/P = nghỉ. Cố ý KHÔNG suy từ `isLeave` — hai
 * con số này phải khớp đúng cột tổng của file Sheet mà kế toán đối chiếu.
 */
export function tongCongNghi(cells: Record<number, { code: string | null } | null | undefined>): {
  cong: number;
  nghi: number;
} {
  let cong = 0;
  let nghi = 0;
  for (const c of Object.values(cells)) {
    if (!c?.code) continue;
    if (c.code === "X" || c.code === "P") nghi += 1;
    else cong += 1;
  }
  return { cong, nghi };
}

export const NHAN_THU = ["CN", "T2", "T3", "T4", "T5", "T6", "T7"] as const;
