// lib/ui/day-trang.ts — dãy số trang hiển thị trên thanh điều hướng.
//
// KHÔNG "use client": server page lẫn client component đều gọi (bài học 12/08/2026 —
// xem lib/ui/phan-trang.ts).

/** Dấu ba chấm ngăn hai đoạn số không liền nhau. */
export const NGAN = "…" as const;

/**
 * Dãy nút số quanh trang hiện tại: luôn có trang ĐẦU và trang CUỐI, cộng `canh` trang mỗi
 * bên trang hiện tại, chỗ đứt thì chèn `…`.
 *
 * ⚠️ Không bao giờ chèn `…` để thay cho ĐÚNG MỘT số: `1 … 3 4 5` trông như đang giấu gì
 * đó trong khi chỗ trống chỉ là số 2 — vẽ thẳng số ra vừa ngắn hơn vừa bấm được.
 */
export function dayTrang(trang: number, soTrang: number, canh = 1): (number | typeof NGAN)[] {
  if (soTrang <= 1) return [1];
  const ht = Math.min(Math.max(1, trang), soTrang);

  // Ít trang thì vẽ HẾT. Với 5 trang mà hiện `1 2 … 5` thì dấu ngăn chỉ che đúng một số,
  // vừa xấu vừa bắt người dùng bấm hai lần cho thứ lẽ ra nằm ngay đó.
  const TRAN_HIEN_HET = 7;
  if (soTrang <= TRAN_HIEN_HET) {
    return Array.from({ length: soTrang }, (_, i) => i + 1);
  }

  const can = new Set<number>([1, soTrang]);
  for (let i = ht - canh; i <= ht + canh; i++) if (i >= 1 && i <= soTrang) can.add(i);

  const ds = [...can].sort((a, b) => a - b);
  const ra: (number | typeof NGAN)[] = [];
  for (let i = 0; i < ds.length; i++) {
    if (i > 0) {
      const cach = ds[i] - ds[i - 1];
      if (cach === 2) ra.push(ds[i] - 1); // chỉ hụt một số → vẽ luôn số đó
      else if (cach > 2) ra.push(NGAN);
    }
    ra.push(ds[i]);
  }
  return ra;
}

/** Class dùng chung cho cả bản client (`DieuHuongTrang`) lẫn bản server (`…Link`). */
export const LOP_NUT =
  "inline-flex h-8 min-w-8 items-center justify-center rounded-lg border border-border px-2 text-sm transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40";
export const LOP_NUT_DANG_XEM =
  "inline-flex h-8 min-w-8 items-center justify-center rounded-lg border border-primary bg-primary px-2 text-sm font-semibold text-primary-foreground";
