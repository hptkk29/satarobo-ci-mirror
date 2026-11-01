import { cn } from "@/lib/utils";

/**
 * Dòng nhãn "ngoài phạm vi đăng ký" dưới một buổi học (QĐ-54). CHỮ do server tính sẵn (`nhanPhamVi`, nguồn duy nhất là
 * `nhanLyDo` ở lib/entitlements/roster.ts, đi qua `lib/portal/tien-do-pham-vi.ts`) — component này KHÔNG viết chữ nào.
 *
 * · `nhan` rỗng / null / undefined ⇒ không vẽ gì (đường cũ; hoặc buổi ân hạn chưa có quyết định về chữ).
 * · Là span block chứ không phải thẻ p: có chỗ dùng nằm trong button, nơi chỉ được chứa phần tử inline.
 * · Cố ý KHÔNG truncate: nhãn có dải bài ("Ngoài phạm vi đăng ký (bài 13–24)") dài hơn dòng ngày tháng, và ở 375px bị cắt thì
 *   phụ huynh không đọc được phạm vi — đó chính là thông tin cần có.
 */
export function NhanPhamVi({ nhan, className }: { nhan: string | null | undefined; className?: string }) {
  if (!nhan) return null;
  return <span className={cn("block text-xs font-medium leading-snug text-caution", className)}>{nhan}</span>;
}
