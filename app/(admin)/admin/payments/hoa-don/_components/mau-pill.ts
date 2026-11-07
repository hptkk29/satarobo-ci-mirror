// Màu CHỮ của nhãn trạng thái (`StatusPill`) ở khu Hoá đơn — dùng token `-ink`, không dùng màu trạng thái gốc.
//
// `StatusPill` mặc định tô chữ bằng `--state-warning` (#f59e0b) trên nền `--state-warning-soft`: đo bằng axe-core ở trình
// duyệt thật (S5c, 01/11/2026) ra 1.95:1 — dưới ngưỡng 4.5:1 của chữ 12px. globals.css §232 đã ghi lý do: nền nhạt phải đi với
// chữ `-ink`. Component dùng chung KHÔNG sửa ở đây (đụng 40+ màn); khu Hoá đơn đè màu chữ qua `className` (cn/twMerge giữ lớp sau).
import type { PillTone } from "@/components/admin/ui/status-pill";

export const CHU_PILL: Record<PillTone, string | undefined> = {
  success: "text-state-success-ink",
  warning: "text-state-warning-ink",
  danger: "text-state-danger-ink",
  info: "text-state-info-ink",
  brand: undefined,
  muted: undefined,
};
