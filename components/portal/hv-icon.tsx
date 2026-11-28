import { cn } from "@/lib/utils";

// Biểu tượng của Cổng học sinh — CHÉP NGUYÊN đường vẽ (path) từ artifact thiết kế để giống 100%.
// Chỉ nét (stroke) dùng currentColor ⇒ đổi màu theo chữ, sáng/tối tự đúng.

export const IC = {
  homnay: "M3 11l9-7 9 7M5 10v10h14V10",
  lich: "M4 5h16v16H4zM4 10h16M8 3v4M16 3v4",
  hanhtrinh: "M12 3l2.6 5.6 6 .7-4.5 4.1 1.2 6L12 16.4 6.7 19.4l1.2-6L3.4 9.3l6-.7z",
  baitap: "M9 4h6l1 3h3v13H5V7h3zM9 13l2 2 4-4",
  sanpham: "M3 8a3 3 0 0 1 3-3h12a3 3 0 0 1 3 3v8a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3zM21 16l-5-5-8 8",
  danhgia: "M8 14s1.5 2 4 2 4-2 4-2M9 9h.01M15 9h.01M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z",
  thongbao: "M6 16V11a6 6 0 0 1 12 0v5l2 2H4zM10 20a2 2 0 0 0 4 0",
  them: "M4 7h16M4 12h16M4 17h16",
  khoa: "M5 11h14v10H5zM8 11V8a4 4 0 0 1 8 0v3",
  coinDong: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v10M9 9.5h4.5a2 2 0 0 1 0 4H9",
  tiep: "M5 12h14M13 6l6 6-6 6",
} as const;

export function Ic({ d, size = 20, className }: { d: string; size?: number; className?: string }) {
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn("shrink-0", className)}
    >
      <path d={d} />
    </svg>
  );
}

/** Đồng SataCoin (vàng cam, viền nâu) — dùng ở thẻ học sinh, nút coin trên điện thoại. */
export function DongCoin({ size = 18, className }: { size?: number; className?: string }) {
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" className={cn("shrink-0", className)}>
      <circle cx="12" cy="12" r="9" fill="var(--sr-orange)" stroke="var(--sr-orange-text)" strokeWidth="2" />
      <path d="M12 7v10M9 9.5h4.5a2 2 0 0 1 0 4H9" fill="none" stroke="var(--sr-orange-text)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

