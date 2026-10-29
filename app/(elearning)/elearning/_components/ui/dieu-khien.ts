/**
 * Lớp CSS thống nhất cho điều khiển biểu mẫu của khu học tập (ô nhập, ô chọn, nút). Chỉ là chuỗi lớp — dùng cho cả
 * Server lẫn Client Component. Mọi điều khiển cao ≥ 40px (vùng bấm tay/điện thoại), có vòng tiêu điểm `ring`.
 *
 * Nút nguy hiểm (huỷ/thu hồi/xoá) dùng `NUT_NGUY` — viền + chữ `danger-ink`, KHÔNG nền đặc: màu đỏ đặc dành cho
 * hành động đã chắc chắn, còn bước đầu của luồng xác nhận thì không nên gào lên.
 */

const VONG = "outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1";

// `_GOC` = không ép bề rộng: dùng khi ô nằm trong hàng flex/lưới và tự quyết `w-*`/`flex-*` (class bề rộng cạnh `w-full`
// thì thứ nào thắng phụ thuộc thứ tự CSS sinh ra — tránh bằng cách không đặt cả hai).
export const O_NHAP_GOC = `h-10 min-w-0 rounded-lg border border-border bg-card px-3 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary disabled:cursor-not-allowed disabled:bg-muted disabled:opacity-70 ${VONG}`;
export const O_CHON_GOC = `h-10 min-w-0 rounded-lg border border-border bg-card px-2.5 text-sm text-foreground focus:border-primary disabled:cursor-not-allowed disabled:bg-muted disabled:opacity-70 ${VONG}`;
export const O_NHAP = `h-10 w-full min-w-0 rounded-lg border border-border bg-card px-3 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary disabled:cursor-not-allowed disabled:bg-muted disabled:opacity-70 ${VONG}`;
export const O_NHAP_VAN_BAN = `min-h-20 w-full min-w-0 rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary disabled:cursor-not-allowed disabled:bg-muted disabled:opacity-70 ${VONG}`;
export const O_CHON = `h-10 w-full min-w-0 rounded-lg border border-border bg-card px-2.5 text-sm text-foreground focus:border-primary disabled:cursor-not-allowed disabled:bg-muted disabled:opacity-70 ${VONG}`;
export const NHAN_O = "block text-sm font-medium text-foreground";
export const GOI_Y_O = "mt-1 text-xs text-muted-foreground";

const NUT = `inline-flex min-h-10 items-center justify-center gap-2 whitespace-nowrap rounded-lg px-4 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${VONG}`;
export const NUT_CHINH = `${NUT} bg-primary text-primary-foreground hover:bg-primary-dark`;
export const NUT_PHU = `${NUT} border border-border bg-card font-medium text-foreground hover:bg-muted`;
export const NUT_NGUY = `${NUT} border border-state-danger/40 bg-card font-medium text-state-danger-ink hover:bg-state-danger-soft`;
export const NUT_NHO = `inline-flex min-h-8 items-center justify-center gap-1.5 whitespace-nowrap rounded-md border border-border bg-card px-2.5 text-xs font-medium text-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60 ${VONG}`;
export const LIEN_KET_CHU = `rounded text-sm font-medium text-primary-ink underline-offset-2 hover:underline ${VONG}`;
