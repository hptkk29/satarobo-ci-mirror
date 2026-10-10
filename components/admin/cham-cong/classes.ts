// components/admin/cham-cong/classes.ts — bảng chuỗi class dùng chung của vỏ admin chấm công.
//
// Vì sao file này tồn tại: 13 màn cũ mỗi màn tự gõ lại class cho nút/chip/ô nhập, nên cùng một
// nút "Lưu" cao 36px chỗ này, 40px chỗ kia, và màu thì có nơi rơi ra thang Tailwind gốc / chữ
// trắng cứng, ngoài token. Gom về một chỗ để sửa một lần là cả module đổi theo — và để việc soi
// màu cấm chỉ phải đọc đúng một file.
//
// CHỈ token: primary/primary-dark/primary-soft/primary-ink · state-*-soft/-ink · muted/card/
// border/foreground/ring. Không hex rời, không màu chữ cứng, không thang màu Tailwind gốc.
// Thư mục này là ADMIN-ONLY ⇒ được dùng `primary-soft`/`primary-ink` (chỉ có trong `.admin-scope`);
// atom dùng chung với site giáo viên nằm ở `components/cham-cong/ui/**` và KHÔNG được nhập file này.
import type { EffectTone } from "@/lib/cham-cong/request-effect";

/** Nút hành động chính (Chốt kỳ, Áp vào hệ thống, Lưu…). Một màn chỉ nên có một nút loại này. */
export const BTN_PRIMARY =
  "inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground shadow-sm transition-colors hover:bg-primary-dark disabled:pointer-events-none disabled:opacity-50";

/** Nút phụ. Cố ý KHÔNG dùng `Button variant="outline"`: trong `.admin-scope` thì
 *  `hover:bg-accent` của nó là CAM ĐẶC — hover ra một màu chẳng mang nghĩa gì ở đây. */
export const BTN_OUTLINE =
  "inline-flex h-9 items-center gap-1.5 rounded-lg border border-border bg-card px-4 text-sm font-semibold text-foreground shadow-sm transition-colors hover:bg-muted disabled:pointer-events-none disabled:opacity-50";

/** Nút phá huỷ (Xoá, Từ chối). Viền + chữ đỏ trên nền thẻ, KHÔNG tô đỏ đặc:
 *  `Button variant="destructive"` dùng `text-destructive-foreground` — token KHÔNG tồn tại. */
export const BTN_DANGER =
  "inline-flex h-9 items-center gap-1.5 rounded-lg border border-state-danger-soft bg-card px-4 text-sm font-semibold text-state-danger-ink shadow-sm transition-colors hover:bg-state-danger-soft disabled:pointer-events-none disabled:opacity-50";

/** Ô nhập/`<select>` cao 36px cho khớp nút. `aria-[invalid=true]` để lỗi hiện bằng viền,
 *  không phải chỉ bằng dòng chữ đỏ ở đâu đó. */
export const FIELD =
  "h-9 rounded-lg border border-border bg-background px-3 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary-soft aria-[invalid=true]:border-state-danger";

/** Chip lọc (khối, bộ lọc cờ). Cao bằng nút để thanh lọc không so le. */
export const CHIP =
  "inline-flex h-9 items-center gap-2 whitespace-nowrap rounded-xl border px-3 text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:ring-ring";
export const CHIP_ACTIVE = "border-primary bg-primary-soft text-primary-ink";
export const CHIP_IDLE = "border-border bg-card text-muted-foreground hover:bg-muted";

/** Tab gạch chân (ModuleNav / MeNav) — mẫu của `/students`. */
export const TAB =
  "whitespace-nowrap border-b-2 px-4 py-2 text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:ring-ring";
export const TAB_ACTIVE = "border-primary text-primary-ink";
export const TAB_IDLE =
  "border-transparent text-muted-foreground hover:border-border hover:text-foreground";

/**
 * Vỏ pill nhỏ trong ô bảng (ghi đè, Chờ tính, loại ngày…).
 * Bản sao CÓ CHỦ ĐÍCH của `PILL` trong `components/cham-cong/ui/flag-chip.tsx`: atom dùng chung
 * không được nhập `components/admin/**`. Hai bản phải giống hệt nhau.
 */
export const PILL =
  "inline-flex shrink-0 items-center whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold";

/**
 * Tông của cột "Thay đổi" ở hàng chờ duyệt đơn (`/don-tu`).
 * Đặt ở đây vì BẢNG và PANEL chi tiết là hai file khác nhau cùng vẽ một giá trị — mỗi bên tự
 * gán màu là hai bản sao rồi trôi ra khỏi nhau (đơn hiện cảnh báo ở bảng, hết cảnh báo khi mở).
 */
export const EFFECT_CLS: Record<EffectTone, string> = {
  default: "",
  muted: "text-muted-foreground",
  warning: "text-state-warning-ink",
};
