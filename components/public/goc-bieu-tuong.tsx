import type { MaMucGoc } from "@/lib/public/goc-gia-dinh";

/**
 * Biểu tượng nhỏ của ba mục trong nhóm «Góc gia đình» — dùng chung cho bảng xổ ở thanh trên và bảng của nút nổi,
 * để hai nơi không vẽ hai kiểu. Chỉ trang trí (`aria-hidden`): nhãn chữ luôn đứng cạnh.
 */
const NET = { width: 20, height: 20, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true, focusable: false } as const;

export function BieuTuongGoc({ ma }: { ma: MaMucGoc }) {
  if (ma === "disc") {
    // Bốn ô màu của DISC (cùng bảng màu với viên thuốc cũ), xoay 45° thành hình thoi.
    return (
      <svg width={20} height={20} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <g transform="rotate(45 12 12)">
          <rect x="4.5" y="4.5" width="7" height="7" rx="1.6" fill="#ff6f00" />
          <rect x="12.5" y="4.5" width="7" height="7" rx="1.6" fill="#ffb300" />
          <rect x="4.5" y="12.5" width="7" height="7" rx="1.6" fill="#c99af0" />
          <rect x="12.5" y="12.5" width="7" height="7" rx="1.6" fill="#2e9e6b" />
        </g>
      </svg>
    );
  }
  if (ma === "tu-sach") {
    return (
      <svg {...NET}>
        <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5z" />
        <path d="M4 19.5A2.5 2.5 0 0 0 6.5 22H20v-5" />
      </svg>
    );
  }
  return (
    <svg {...NET}>
      <path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l1 1.1L12 21l7.8-7.5 1-1.1a5.5 5.5 0 0 0 0-7.8z" />
    </svg>
  );
}
