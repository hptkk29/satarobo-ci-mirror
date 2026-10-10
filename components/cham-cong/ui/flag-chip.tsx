// components/cham-cong/ui/flag-chip.tsx — chip cờ hậu kiểm của một ngày công.
//
// Vì sao file này tồn tại: bảng công ngày, Sheet chi tiết ngày, kỳ công, đối soát và lịch ca
// bên site giáo viên đều in CÙNG bộ cờ. Trước đây mỗi màn tự ghép tone + nhãn, nên mã engine
// mới thêm rơi ra màn hình dạng `THIEU_LUOT_RA` trần. Một chip, một bảng nhãn.
//
// Thư mục này site GV mount chung ⇒ CHỈ token `:root` (state-*, muted). KHÔNG `primary-*`.
import { cn } from "@/lib/utils";
import { flagInfo, type FlagTone } from "@/lib/cham-cong/flag-labels";

/**
 * Bản sao CÓ CHỦ ĐÍCH của `PILL` trong `components/admin/cham-cong/classes.ts`: atom dùng chung
 * không được import `components/admin/**` (site GV không có vỏ admin).
 */
export const PILL =
  "inline-flex shrink-0 items-center whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold";

const TONE: Record<FlagTone, string> = {
  danger: "bg-state-danger-soft text-state-danger-ink",
  warn: "bg-state-warning-soft text-state-warning-ink",
  info: "bg-muted text-muted-foreground",
};

/** Một cờ. Mã lạ in nguyên mã (tông info) — `title` luôn là mã thật để người rà tra được. */
export function FlagChip({ code, className }: { code: string; className?: string }) {
  const info = flagInfo(code);
  return (
    <span
      className={cn(PILL, TONE[info.tone], "max-w-[10rem]", className)}
      title={code}
    >
      <span className="truncate">{info.text}</span>
    </span>
  );
}

/**
 * Danh sách cờ của một dòng bảng: hiện `max` chip đầu, phần còn lại gom vào chip `+N` mang
 * `title` liệt kê đủ nhãn — ô bảng 44px không giãn theo người có 5 cờ.
 * Thứ tự do nơi gọi quyết định (page sắp danger lên trước), atom không tự sắp lại.
 */
export function FlagList({
  codes,
  max = 2,
  className,
}: {
  codes: string[];
  max?: number;
  className?: string;
}) {
  if (codes.length === 0) return null;
  const shown = codes.slice(0, max);
  const rest = codes.slice(max);
  return (
    <span className={cn("inline-flex flex-wrap items-center gap-1", className)}>
      {shown.map((code) => (
        <FlagChip key={code} code={code} />
      ))}
      {rest.length > 0 && (
        <span
          className={cn(PILL, TONE.info)}
          title={rest.map((code) => flagInfo(code).text).join(" · ")}
        >
          +{rest.length}
        </span>
      )}
    </span>
  );
}
