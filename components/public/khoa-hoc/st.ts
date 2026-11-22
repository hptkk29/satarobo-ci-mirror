import type { CSSProperties } from "react";

/**
 * Đổi chuỗi CSS nội tuyến của bản thiết kế ("display: flex; gap: 10px") thành đối tượng `style`
 * của React. Giữ NGUYÊN chuỗi gốc của artifact để so từng giá trị với thiết kế khi cần.
 *
 * Hàm thuần, có nhớ đệm — cùng một chuỗi trả cùng một đối tượng (không tạo mới mỗi lần render).
 * Biến CSS (`--c`) giữ nguyên tên; thuộc tính có tiền tố trình duyệt (`-webkit-…`) → `WebkitTextFill…`.
 * Tên phông của artifact ('Unbounded', 'Space Grotesk', 'Space Mono') được nối vào biến next/font tương ứng
 * (cùng cách `FF` ở components/public/pub-root.tsx) — nếu không, phông nạp bằng next/font không được dùng.
 */
/**
 * Phông của ký hiệu ● ở nhãn `.label`: ● không có trong Space Mono nên artifact rơi về monospace hệ thống; biến next/font
 * (`var(--font-space-mono)`) còn chèn "Space Mono Fallback" (Courier New chỉnh cỡ) làm ● rộng hơn ~3px và nhãn dài gãy dòng
 * sớm hơn thiết kế ở 390px. Dùng tên họ phông trần, KHÔNG qua `st()`/biến.
 */
export const CHU_BIEU_TUONG = "'Space Mono', monospace";

/**
 * Phông chữ thân trang đúng như artifact (`.page{font-family:'Space Grotesk','Segoe UI',system-ui,sans-serif}`), dùng TÊN họ phông trần.
 * Biến next/font chèn "Space Grotesk Fallback" (Arial chỉnh cỡ) trước Segoe UI nên ký tự không có trong Space Grotesk (→, 🎁…)
 * rộng khác artifact và đoạn văn gãy dòng khác (đo 03/11: thẻ ODAMPCA cao hơn 25px ở 390px).
 */
export const CHU_THAN_TRANG = "'Space Grotesk', 'Segoe UI', system-ui, sans-serif";

/** Mũi tên → trong tiêu đề Unbounded: Unbounded không có glyph, artifact rơi về sans-serif hệ thống còn next/font rơi về "Unbounded Fallback" (Arial chỉnh cỡ) nên mũi tên lệch cỡ. */
export const CHU_MUI_TEN = "'Unbounded', sans-serif";

const NHO_DEM = new Map<string, CSSProperties>();

const PHONG: [RegExp, string][] = [
  [/'Unbounded'/g, "var(--font-unbounded),'Unbounded'"],
  [/'Space Grotesk'/g, "var(--font-space-grotesk),'Space Grotesk'"],
  [/'Space Mono'/g, "var(--font-space-mono),'Space Mono'"],
];

export function noiPhong(gt: string): string {
  let kq = gt;
  for (const [re, thay] of PHONG) kq = kq.replace(re, thay);
  return kq;
}

function tachKhaiBao(css: string): string[] {
  const kq: string[] = [];
  let sau = 0;
  let dau = 0;
  for (let i = 0; i < css.length; i += 1) {
    const c = css[i];
    if (c === "(") sau += 1;
    else if (c === ")") sau = Math.max(0, sau - 1);
    else if (c === ";" && sau === 0) {
      kq.push(css.slice(dau, i));
      dau = i + 1;
    }
  }
  kq.push(css.slice(dau));
  return kq;
}

function tenReact(prop: string): string {
  if (prop.startsWith("--")) return prop;
  const p = prop.startsWith("-ms-") ? prop.slice(1) : prop;
  return p.replace(/-([a-z])/g, (_, ch: string) => ch.toUpperCase());
}

export function st(css: string): CSSProperties {
  const da = NHO_DEM.get(css);
  if (da) return da;
  const kq: Record<string, string> = {};
  for (const kb of tachKhaiBao(css)) {
    const i = kb.indexOf(":");
    if (i < 0) continue;
    const ten = kb.slice(0, i).trim();
    const gt = kb.slice(i + 1).trim();
    if (!ten || !gt) continue;
    kq[tenReact(ten)] = /font/.test(ten) ? noiPhong(gt) : gt;
  }
  const out = kq as CSSProperties;
  NHO_DEM.set(css, out);
  return out;
}
