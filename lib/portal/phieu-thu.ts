// lib/portal/phieu-thu.ts — xếp danh sách phiếu thu cho phụ huynh khi có bút toán ĐIỀU CHỈNH.
//
// Bước 5. Từ 07/09/2026 một phiếu thu có thể kèm bút toán điều chỉnh: dòng riêng, mang
// phần CHÊNH LỆCH (âm khi giảm), trỏ `adjustmentOfId` về phiếu gốc.
//
// Luật hiển thị — không thương lượng:
//
//  1. **Dòng gốc giữ nguyên con số cũ.** Nó là tiền thật đã đối soát sao kê. Sửa số hiển
//     thị là nói dối phụ huynh về một bút toán đã có thật; và khi họ đối chiếu với biên
//     lai giấy đang cầm trên tay thì hai bên lệch nhau mà không ai giải thích được.
//     Dòng gốc chỉ được thêm NHÃN "đã điều chỉnh".
//  2. **Bút toán điều chỉnh là DÒNG RIÊNG**, in đúng số delta kèm dấu, kèm LÝ DO.
//  3. **Tổng ở cuối** — vì chỉ khi cộng cả hai dòng mới ra số đúng.
//
// File này CỐ Ý không `server-only`: nó là logic thuần, phải test được không cần DB.
// Đường đọc DB nằm ở `lib/portal/billing.ts`.

/** Phần tối thiểu của một dòng phiếu thu mà thuật toán xếp cần biết. */
export type DongPhieuThu = {
  id: string;
  amount: number;
  paymentType: string;
  adjustmentOfId: string | null;
  /** Dùng để xếp nhiều lần điều chỉnh trên cùng một phiếu theo đúng thứ tự đã làm. */
  confirmedAt: string | null;
};

export type DongPhieuThuDaXep<T> = T & {
  /** Dòng gốc đã bị điều chỉnh ≥ 1 lần → gắn nhãn, KHÔNG đổi số. */
  daBiDieuChinh: boolean;
};

/**
 * Xếp lại danh sách để mỗi bút toán điều chỉnh nằm NGAY DƯỚI phiếu thu gốc của nó.
 *
 * Giữ nguyên thứ tự của các phiếu gốc do caller đưa vào (thường là mới nhất trước) — hàm
 * này chỉ chèn, không sắp xếp lại phiếu gốc. Nhiều lần điều chỉnh trên cùng một phiếu xếp
 * theo `confirmedAt` TĂNG DẦN: phụ huynh đọc được diễn biến theo đúng trình tự đã xảy ra.
 *
 * Bút toán điều chỉnh MỒ CÔI (phiếu gốc không nằm trong danh sách — ví dụ bị lọc mất vì
 * một điều kiện khác) KHÔNG bị bỏ đi: nó vẫn là tiền đã vào sổ, bỏ đi là tổng hiển thị
 * lệch với "Đã thanh toán". Những dòng đó rơi xuống cuối, giữ nguyên thứ tự.
 */
export function xepPhieuThuVaDieuChinh<T extends DongPhieuThu>(
  rows: T[],
): DongPhieuThuDaXep<T>[] {
  const dieuChinhTheoGoc = new Map<string, T[]>();
  const goc: T[] = [];
  const moCoi: T[] = [];
  const idCoMat = new Set(rows.map((r) => r.id));

  for (const r of rows) {
    if (r.paymentType === "ADJUSTMENT" && r.adjustmentOfId) {
      if (!idCoMat.has(r.adjustmentOfId)) {
        moCoi.push(r);
        continue;
      }
      const list = dieuChinhTheoGoc.get(r.adjustmentOfId);
      if (list) list.push(r);
      else dieuChinhTheoGoc.set(r.adjustmentOfId, [r]);
      continue;
    }
    goc.push(r);
  }

  for (const list of dieuChinhTheoGoc.values()) {
    list.sort((a, b) => (a.confirmedAt ?? "").localeCompare(b.confirmedAt ?? ""));
  }

  const ra: DongPhieuThuDaXep<T>[] = [];
  for (const g of goc) {
    const con = dieuChinhTheoGoc.get(g.id) ?? [];
    ra.push({ ...g, daBiDieuChinh: con.length > 0 });
    for (const c of con) ra.push({ ...c, daBiDieuChinh: false });
  }
  for (const m of moCoi) ra.push({ ...m, daBiDieuChinh: false });
  return ra;
}

/**
 * Tổng của danh sách phiếu thu ĐANG HIỂN THỊ.
 *
 * Cộng thẳng `amount` của mọi dòng — kể cả dòng điều chỉnh mang số âm. Đó chính là lý do
 * dòng gốc được phép giữ số cũ mà tổng vẫn đúng.
 */
export function tongPhieuThuHienThi(rows: { amount: number }[]): number {
  return rows.reduce((s, r) => s + r.amount, 0);
}

/** Số tiền kèm dấu, dùng cho DÒNG ĐIỀU CHỈNH (`+1.000.000 đ` / `−1.000.000 đ`). */
export function soTienCoDau(n: number): string {
  // Dấu trừ THẬT (U+2212), không phải hyphen: ở cỡ chữ nhỏ hyphen dễ bị đọc nhầm thành
  // gạch nối, mà đây là chỗ một dấu đọc sai làm lệch hẳn ý nghĩa con số.
  const dau = n < 0 ? "−" : "+";
  return `${dau}${Math.abs(n).toLocaleString("vi-VN")} đ`;
}
