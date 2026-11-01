"use client";

// Ô chọn ngày dùng chung cho site giáo viên.
//
// Vì sao (QA site GV vòng 1, BUG-035): `<input type="date">` hiển thị theo locale của
// TRÌNH DUYỆT, nên trên máy đặt tiếng Anh nó ra "08/28/2026" kèm gợi ý "mm/dd/yyyy"
// giữa một ứng dụng toàn tiếng Việt dùng dd/mm/yyyy. Giáo viên quen dd/mm rất dễ gõ
// 08/09 khi định nói "8 tháng 9" mà hệ thống hiểu là "9 tháng 8" — với đơn từ và chỉnh
// công thì sai ngày là sai công.
//
// KHÔNG tự dựng lịch riêng: `type="date"` là thứ đọc được bằng bàn phím, có lịch của
// hệ điều hành trên di động, và trình đọc màn hình hiểu sẵn. Thay vào đó in ra NGAY
// DƯỚI ô ngày đã chọn theo dd/mm/yyyy — người dùng đọc được đúng thứ mình vừa chọn dù
// trình duyệt hiển thị kiểu gì. Muốn thay hẳn bằng lịch tự dựng thì đó là việc riêng,
// và phải làm cho cả 4 site chứ không riêng site này.
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

/** "2026-08-28" → "28/08/2026". Chuỗi rỗng/không hợp lệ → "". */
export function nhanNgayVN(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim());
  if (!m) return "";
  return `${m[3]}/${m[2]}/${m[1]}`;
}

export function ONgay({
  id,
  label,
  value,
  onChange,
  disabled,
  required,
  min,
  max,
  error,
  hint,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  required?: boolean;
  min?: string;
  max?: string;
  /** Lỗi hiển thị NGAY DƯỚI ô — không chỉ toast (BUG-039). */
  error?: string | null;
  hint?: string;
}) {
  const moTa = [error ? `${id}-loi` : null, `${id}-doc`].filter(Boolean).join(" ");
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>
        {label}
        {required && (
          <span className="ml-0.5 text-state-danger-ink" aria-hidden>
            *
          </span>
        )}
      </Label>
      <Input
        id={id}
        type="date"
        value={value}
        min={min}
        max={max}
        disabled={disabled}
        required={required}
        aria-required={required || undefined}
        aria-invalid={error ? true : undefined}
        aria-describedby={moTa || undefined}
        onChange={(e) => onChange(e.target.value)}
        className={cn(error && "border-state-danger-ink")}
      />
      {/* Dòng đọc lại: luôn hiện khi đã chọn ngày, kể cả khi trình duyệt đang hiển thị
          đúng dd/mm — người dùng không phải đoán trình duyệt mình đang ở kiểu nào. */}
      <p id={`${id}-doc`} className="text-xs text-muted-foreground">
        {value ? `Ngày đã chọn: ${nhanNgayVN(value)}` : (hint ?? "Chưa chọn ngày")}
      </p>
      {error && (
        <p id={`${id}-loi`} className="text-xs font-medium text-state-danger-ink">
          {error}
        </p>
      )}
    </div>
  );
}
