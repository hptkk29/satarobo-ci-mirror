// components/admin/nguon-hoa-hong/classes.ts — chuỗi class dùng chung của vỏ module "Nguồn lead & Chính sách
// hoa hồng". Cố ý KHÔNG import `components/admin/cham-cong/classes.ts` (06 §0: chép ý tưởng, không import chéo
// module) — nhưng giữ CÙNG token để hai module nhìn như một hệ.
//
// CHỈ token: primary/primary-soft/primary-ink · state-*-soft/-ink · muted/card/border/foreground/ring. Không
// hex rời, không thang màu Tailwind gốc, không gradient (DESIGN.md §1, §7). Thư mục này là ADMIN-ONLY nên được
// dùng `primary-soft`/`primary-ink` (chỉ có trong `.admin-scope`).

/** Nút phụ (viền). Không dùng `Button variant="outline"`: trong `.admin-scope` hover của nó là CAM ĐẶC. */
export const BTN_OUTLINE =
  "inline-flex h-9 items-center gap-1.5 whitespace-nowrap rounded-lg border border-border bg-card px-4 text-sm font-semibold text-foreground shadow-sm transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring";

/**
 * Kích cỡ cho nút NHỎ nằm trong dòng / khung (Bỏ·Đổi, Tải lại, Lưu·Huỷ từng dòng…): dưới `md` cao 44px (vùng chạm đạt chuẩn — ngón tay, không phải con trỏ), từ `md` trở lên gọn 32px
 * như trước. Dùng SAU `BTN_OUTLINE`/`BTN_PRIMARY` trong `cn(…)` (tailwind-merge cho `h-11 md:h-8` thắng `h-9`). Lưới `[W4-L1]` cấm viết `"h-8 …"` trần ở những nút này.
 */
export const NUT_NHO = "h-11 px-3 md:h-8";

/**
 * Nút ở CHÂN hộp thoại / Sheet: dưới `sm` cao 44px (vùng chạm cho ngón tay), từ `sm` trở lên giữ 36px như `BTN_*`. Giữ nguyên bề ngang (`px-4` của `BTN_*`) — khác `NUT_NHO`, vốn gọn cả chiều ngang
 * cho nút nằm TRONG dòng. Dùng SAU `BTN_OUTLINE`/`BTN_PRIMARY` trong `cn(…)`. Lưới `[W4-L1b]` cấm `className={BTN_OUTLINE|BTN_PRIMARY}` trần ở các hộp thoại/Sheet.
 */
export const NUT_CHAN = "h-11 sm:h-9";

/** Chip lọc (cơ sở, lý do). Cao 36px bằng nút để thanh lọc không so le. */
export const CHIP =
  "inline-flex h-9 items-center gap-2 whitespace-nowrap rounded-xl border px-3 text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:ring-ring";
export const CHIP_ACTIVE = "border-primary bg-primary-soft text-primary-ink";
export const CHIP_IDLE = "border-border bg-card text-muted-foreground hover:bg-muted";

/** Tab gạch chân (ModuleNav) — mẫu của `/students`. */
export const TAB =
  "inline-flex shrink-0 items-center gap-2 whitespace-nowrap border-b-2 px-4 py-2 text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:ring-ring";
export const TAB_ACTIVE = "border-primary text-primary-ink";
export const TAB_IDLE = "border-transparent text-muted-foreground hover:border-border hover:text-foreground";

/** Số nhỏ cạnh nhãn tab / chip ("có N việc"). Ẩn khi 0 — người gọi không vẽ khi bằng 0. */
export const SO_DEM =
  "inline-flex min-w-5 items-center justify-center rounded-full bg-state-warning-soft px-1.5 py-0.5 text-xs font-semibold tabular-nums text-state-warning-ink";

/** Vỏ pill nhỏ trong ô bảng. `StatusPill` đã có; hằng này cho phần tử cần cùng hình mà không cần tone. */
export const PILL =
  "inline-flex shrink-0 items-center whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold";

/** Khối bảng: bo góc + viền; vùng cuộn là div CON (không trùng thẻ bo góc — luật vỏ bảng 06/09). */
export const VO_BANG = "overflow-hidden rounded-xl border border-border bg-card";

/** Nút chính. Cùng nghĩa với `BTN_PRIMARY` của chấm công (chép ý tưởng, không import chéo module — 06 §0). */
export const BTN_PRIMARY =
  "inline-flex h-9 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground shadow-sm transition-colors hover:bg-primary-dark focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50";

/** Ô nhập một dòng. `aria-invalid="true"` đổi viền sang danger — lỗi nằm CẠNH ô, không chỉ ở toast. */
export const FIELD =
  "h-9 w-full rounded-lg border border-border bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground transition-colors focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary-soft aria-[invalid=true]:border-state-danger disabled:cursor-not-allowed disabled:opacity-50";

/** Ô nhập nhiều dòng (giải trình, lý do). */
export const TEXTAREA =
  "min-h-20 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground transition-colors focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary-soft aria-[invalid=true]:border-state-danger disabled:cursor-not-allowed disabled:opacity-50";

/** Nút nguy hiểm nhẹ (huỷ nháp): viền + chữ đỏ ngữ nghĩa, không tô đặc. */
export const BTN_DANGER_OUTLINE =
  "inline-flex h-9 items-center gap-1.5 whitespace-nowrap rounded-lg border border-border bg-card px-4 text-sm font-semibold text-state-danger-ink shadow-sm transition-colors hover:bg-state-danger-soft focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50";

/** Ô nhập / chọn cùng chiều cao 36px với nút để một hàng điều khiển không so le. `aria-invalid` đổi viền sang đỏ. */
export const O_NHAP =
  "h-9 w-full min-w-0 rounded-lg border border-input bg-card px-3 text-sm text-foreground transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground aria-[invalid=true]:border-state-danger-ink aria-[invalid=true]:ring-2 aria-[invalid=true]:ring-state-danger-ink/20";

/** Nhãn của một ô trong form. */
export const NHAN_O = "mb-1 block text-sm font-semibold text-foreground";

/** Dòng lỗi cạnh ô. */
export const LOI_O = "mt-1 text-sm text-state-danger-ink";

