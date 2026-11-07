import { Space_Grotesk, Space_Mono, Unbounded } from "next/font/google";

// Phông của giao diện public (artifact "Sata Robo — Website mới"): Unbounded · Space Grotesk · Space Mono
// nạp bằng next/font; họ thứ tư, Bitter 800, ĐÃ được nạp ở `app/layout.tsx` (biến `--font-display`, 700/800)
// nên không nạp lần hai — `pub-root.tsx` gán `--font-bitter-800: var(--font-display)` cho CSS đang dùng.
// Chỉ nạp độ đậm đang dùng. Biến CSS được `app/(public)/pub-design/*.css` đọc.
const unbounded = Unbounded({
  variable: "--font-unbounded",
  subsets: ["vietnamese", "latin"],
  weight: ["500", "600", "700"],
  display: "swap",
  // Không chèn "<Họ> Fallback" (Arial chỉnh size-adjust) vào chuỗi font-family: nó đứng TRƯỚC Segoe UI/monospace nên glyph thiếu
  // trong phông (→ ●) rơi vào Arial thay vì phông hệ thống như artifact ⇒ lệch độ rộng. Đo: docs/public-redesign/NEN-PUBLIC-V2.md §5b.
  adjustFontFallback: false,
});

const spaceGrotesk = Space_Grotesk({
  variable: "--font-space-grotesk",
  subsets: ["vietnamese", "latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
  // Không chèn "<Họ> Fallback" (Arial chỉnh size-adjust) vào chuỗi font-family: nó đứng TRƯỚC Segoe UI/monospace nên glyph thiếu
  // trong phông (→ ●) rơi vào Arial thay vì phông hệ thống như artifact ⇒ lệch độ rộng. Đo: docs/public-redesign/NEN-PUBLIC-V2.md §5b.
  adjustFontFallback: false,
});

const spaceMono = Space_Mono({
  variable: "--font-space-mono",
  subsets: ["vietnamese", "latin"],
  weight: ["400", "700"],
  display: "swap",
  // Không chèn "<Họ> Fallback" (Arial chỉnh size-adjust) vào chuỗi font-family: nó đứng TRƯỚC Segoe UI/monospace nên glyph thiếu
  // trong phông (→ ●) rơi vào Arial thay vì phông hệ thống như artifact ⇒ lệch độ rộng. Đo: docs/public-redesign/NEN-PUBLIC-V2.md §5b.
  adjustFontFallback: false,
});

/** Chuỗi class gắn lên phần tử gốc `.page` để các biến font có hiệu lực bên trong nó. */
export const PUB_FONT_CLASSES = `${unbounded.variable} ${spaceGrotesk.variable} ${spaceMono.variable}`;

/**
 * Họ phông THẬT (bỏ họ "<Tên> Fallback"): Next 16 vẫn chèn phông lùi Arial chỉnh cỡ vào `style.fontFamily` dù đã đặt `adjustFontFallback: false`
 * (đo 03/11: chuỗi vẫn ra `"Space Grotesk","Space Grotesk Fallback",…` kể cả sau khi xoá `.next/dev`). Glyph thiếu (→ ●) rơi vào Arial đó thay vì
 * Segoe UI/monospace như artifact ⇒ lệch độ rộng. Ghi đè biến CSS trên phần tử gốc bằng họ phông đầu tiên.
 */
const hoDau = (fontFamily: string): string => fontFamily.split(",")[0]!.trim();
export const PUB_FONT_VARS = {
  "--font-unbounded": hoDau(unbounded.style.fontFamily),
  "--font-space-grotesk": hoDau(spaceGrotesk.style.fontFamily),
  "--font-space-mono": hoDau(spaceMono.style.fontFamily),
} as const;

/**
 * Giá trị `font-family` cho style nội tuyến (JSX chép từ artifact có `fontFamily: "'Unbounded', sans-serif"`):
 * dùng các hằng này thay chuỗi gốc để họ phông next/font có hiệu lực.
 */
export const FF = {
  unbounded: "var(--font-unbounded), 'Unbounded', sans-serif",
  grotesk: "var(--font-space-grotesk), 'Space Grotesk', 'Segoe UI', system-ui, sans-serif",
  mono: "var(--font-space-mono), 'Space Mono', monospace",
  bitter: "var(--font-bitter-800), 'Bitter', Georgia, serif",
} as const;
