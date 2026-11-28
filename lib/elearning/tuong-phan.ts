// Đo tương phản WCAG 2.x cho token màu của khu e-learning — hàm THUẦN, dùng trong test
// (`tests/elearning/theme-tuong-phan.test.ts`). Không import gì ngoài chuẩn.

export type Rgba = { r: number; g: number; b: number; a: number };

/** Đọc `#rgb`, `#rrggbb` hoặc `rgba(r, g, b, a)` / `rgb(r, g, b)`. Chuỗi lạ ⇒ ném lỗi (không đoán). */
export function docMau(chuoi: string): Rgba {
  const s = chuoi.trim().toLowerCase();
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/.exec(s);
  if (hex) {
    const h = hex[1].length === 3 ? hex[1].split("").map((c) => c + c).join("") : hex[1];
    return {
      r: parseInt(h.slice(0, 2), 16),
      g: parseInt(h.slice(2, 4), 16),
      b: parseInt(h.slice(4, 6), 16),
      a: 1,
    };
  }
  const rgb = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)$/.exec(s);
  if (rgb) return { r: +rgb[1], g: +rgb[2], b: +rgb[3], a: rgb[4] === undefined ? 1 : +rgb[4] };
  throw new Error(`Không đọc được màu: "${chuoi}"`);
}

/** Phủ `tren` (có thể trong suốt) lên nền ĐẶC `nen`. */
export function phuLen(tren: Rgba, nen: Rgba): Rgba {
  const a = tren.a;
  return {
    r: Math.round(tren.r * a + nen.r * (1 - a)),
    g: Math.round(tren.g * a + nen.g * (1 - a)),
    b: Math.round(tren.b * a + nen.b * (1 - a)),
    a: 1,
  };
}

function kenh(v: number): number {
  const c = v / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

export function doSang(m: Rgba): number {
  return 0.2126 * kenh(m.r) + 0.7152 * kenh(m.g) + 0.0722 * kenh(m.b);
}

/** Tỉ lệ tương phản giữa hai màu ĐẶC (1…21). */
export function tiLeTuongPhan(a: Rgba, b: Rgba): number {
  const la = doSang(a);
  const lb = doSang(b);
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}
