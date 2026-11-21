/**
 * Lớp Tailwind dùng chung cho hành trình DISC — kế thừa thế giới trang public (trắng chiếm ưu thế,
 * cam = hành động, tím = thông tin/phụ, Be Vietnam Pro, bo góc xl/2xl).
 *
 * Tương phản (đã tính, không ước lượng): chữ trắng trên cam-500 chỉ ~2,8:1 (trượt 4,5:1) nên nút
 * chính dùng nền cam-500 + chữ neutral-900 (~7:1). Chữ cam trên nền trắng dùng orange-700 (~5,2:1).
 * Vùng chạm tối thiểu 44px (min-h-11), vòng focus nhìn thấy được, chuyển động chỉ khi motion-safe.
 */
export const NUT_CHINH =
  "inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-orange-500 px-6 py-3 text-base font-bold text-neutral-900 " +
  "transition-colors hover:bg-orange-400 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-orange-300 " +
  "disabled:cursor-not-allowed disabled:bg-neutral-200 disabled:text-neutral-600 motion-reduce:transition-none";

export const NUT_PHU =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-neutral-300 bg-white px-5 py-2.5 text-base font-semibold text-neutral-800 " +
  "transition-colors hover:bg-neutral-50 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-violet-300 " +
  "disabled:cursor-not-allowed disabled:text-neutral-500 motion-reduce:transition-none";

export const O_NHAP =
  "block min-h-11 w-full rounded-xl border border-neutral-300 bg-white px-4 py-2.5 text-base text-neutral-900 placeholder:text-neutral-500 " +
  "focus-visible:border-violet-600 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-violet-200 " +
  "aria-[invalid=true]:border-red-700 aria-[invalid=true]:ring-red-100";

export const NHAN_TRUONG = "mb-1.5 block text-sm font-semibold text-neutral-900";
export const GOI_Y = "mt-1.5 text-sm leading-relaxed text-neutral-600";
export const LOI_TRUONG = "mt-1.5 text-sm font-medium text-red-700";
export const THE = "rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm sm:p-6";
