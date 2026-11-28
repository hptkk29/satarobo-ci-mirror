// Lớp CSS của nút/ô nhập theo thiết kế HTML (`.btn`, `.btn-p/-s/-q`, `.btn-sm`, `.fld`): nút cao 40 (nhỏ 32), bo 10 (nhỏ 8), chữ 14/500 (nhỏ 13).
// MỘT nơi để mọi màn người học dùng cùng một kiểu nút — màn nào tự viết lại là lại lệch thiết kế một chút.
const GOC =
  "inline-flex items-center justify-center gap-2 whitespace-nowrap border font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2";
const CO_THUONG = "h-10 rounded-[10px] px-4 text-sm";
const CO_NHO = "h-8 rounded-lg px-3 text-[13px]";

export const NUT_CHINH = `${GOC} ${CO_THUONG} border-transparent bg-primary text-primary-foreground hover:bg-primary-dark`;
export const NUT_PHU = `${GOC} ${CO_THUONG} border-input bg-card text-foreground hover:bg-secondary`;
export const NUT_LANG = `${GOC} ${CO_THUONG} border-transparent bg-transparent text-[color:var(--el-text2)] hover:bg-secondary hover:text-foreground`;
export const NUT_CHINH_NHO = `${GOC} ${CO_NHO} border-transparent bg-primary text-primary-foreground hover:bg-primary-dark`;
export const NUT_PHU_NHO = `${GOC} ${CO_NHO} border-input bg-card text-foreground hover:bg-secondary`;
export const NUT_LANG_NHO = `${GOC} ${CO_NHO} border-transparent bg-transparent text-[color:var(--el-text2)] hover:bg-secondary hover:text-foreground`;

/** Nhãn của ô nhập (`.fld`): chữ 13/500 màu phụ đậm, ô nhập cao ≥ 40. */
export const NHAN_O = "flex min-w-0 flex-col gap-1.5 text-[13px] font-medium text-[color:var(--el-text2)]";
export const O_NHAP =
  "min-h-10 w-full rounded-lg border border-input bg-card px-3 py-2 text-sm font-normal text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring";
