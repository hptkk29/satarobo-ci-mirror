import type { ReactNode } from "react";

/** Các biểu tượng nét (24×24, nét 2) dùng trong thẻ thông tin và "con nhận được gì" của thiết kế. */
const HINH: Record<string, ReactNode> = {
  I0: (
    <>
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8" />
    </>
  ),
  I1: (
    <>
      <circle cx="12" cy="12" r="10" />
      <path d="M12 6v6l4 2" />
    </>
  ),
  I2: (
    <>
      <circle cx="12" cy="12" r="10" />
      <circle cx="12" cy="12" r="6" />
      <circle cx="12" cy="12" r="2" />
    </>
  ),
  I3: (
    <>
      <rect x="2" y="6" width="20" height="12" rx="2" />
      <circle cx="12" cy="12" r="2.5" />
    </>
  ),
  I4: <path d="M12 2l2.4 7.2H22l-6.2 4.5 2.4 7.3L12 16.5 5.8 21l2.4-7.3L2 9.2h7.6z" />,
  I5: (
    <>
      <path d="M23 6l-9.5 9.5-5-5L1 18" />
      <path d="M17 6h6v6" />
    </>
  ),
};

type Props = { ma: string; size?: number };

export function BieuTuong({ ma, size = 18 }: Props) {
  const hinh = HINH[ma];
  if (!hinh) return null;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      // Tailwind preflight đặt svg{display:block}; artifact không có luật đó nên biểu tượng nằm TRONG DÒNG.
      style={{ display: "inline" }}
    >
      {hinh}
    </svg>
  );
}
