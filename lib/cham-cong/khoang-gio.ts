// lib/cham-cong/khoang-gio.ts — phép tính trên KHOẢNG PHÚT trong ngày (đợt 4+ đơn từ). THUẦN.
//
// Khoảng là nửa mở [start, end), đơn vị phút kể từ 00:00 giờ VN. Mọi hàm trả danh sách ĐÃ GỘP,
// sắp tăng dần — để `tong()` không bao giờ đếm hai lần một phút nằm trong hai khoảng chồng nhau.
export type Khoang = { start: number; end: number };

export function gop(ds: readonly Khoang[]): Khoang[] {
  const xs = ds.filter((x) => x.end > x.start).map((x) => ({ ...x })).sort((a, b) => a.start - b.start);
  const out: Khoang[] = [];
  for (const x of xs) {
    const cuoi = out[out.length - 1];
    if (cuoi && x.start <= cuoi.end) cuoi.end = Math.max(cuoi.end, x.end);
    else out.push(x);
  }
  return out;
}

export function tong(ds: readonly Khoang[]): number {
  return gop(ds).reduce((s, x) => s + (x.end - x.start), 0);
}

/** Phần chung của hai tập khoảng. */
export function giao(a: readonly Khoang[], b: readonly Khoang[]): Khoang[] {
  const out: Khoang[] = [];
  for (const x of gop(a)) {
    for (const y of gop(b)) {
      const s = Math.max(x.start, y.start);
      const e = Math.min(x.end, y.end);
      if (e > s) out.push({ start: s, end: e });
    }
  }
  return gop(out);
}

/** `a` bỏ đi mọi phút thuộc `b`. */
export function tru(a: readonly Khoang[], b: readonly Khoang[]): Khoang[] {
  let con = gop(a);
  for (const y of gop(b)) {
    const moi: Khoang[] = [];
    for (const x of con) {
      if (y.end <= x.start || y.start >= x.end) {
        moi.push(x);
        continue;
      }
      if (y.start > x.start) moi.push({ start: x.start, end: y.start });
      if (y.end < x.end) moi.push({ start: y.end, end: x.end });
    }
    con = moi;
  }
  return gop(con);
}

/** "HH:mm" → phút; sai định dạng ⇒ null (không ném — dữ liệu đơn do người gõ). */
export function phutCua(hhmm: string | null | undefined): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec((hhmm ?? "").trim());
  if (!m) return null;
  const h = Number(m[1]);
  const mi = Number(m[2]);
  if (h > 23 || mi > 59) return null;
  return h * 60 + mi;
}

/** Khoảng từ hai mốc "HH:mm"; thiếu / ngược chiều ⇒ null. */
export function khoangTu(tu: string | null | undefined, den: string | null | undefined): Khoang | null {
  const s = phutCua(tu);
  const e = phutCua(den);
  if (s === null || e === null || e <= s) return null;
  return { start: s, end: e };
}
