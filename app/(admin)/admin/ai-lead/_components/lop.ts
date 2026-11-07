// Lớp Tailwind dùng chung cho ô nhập của màn AI Lead. Cao 44px (vùng chạm), cỡ chữ 16px ở di động để iOS không phóng to khi focus.
export const LOP_O_CHON =
  "h-11 w-full min-w-0 overflow-hidden rounded-lg border border-input bg-background px-2.5 text-base outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 md:text-sm";
export const LOP_O_NHAP = `${LOP_O_CHON} placeholder:text-muted-foreground`;
export const LOP_THE = "min-w-0 rounded-xl border border-border bg-card p-4 sm:p-5";
