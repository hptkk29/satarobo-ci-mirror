import { Cake } from "lucide-react";
import type { SessionBirthday } from "@/lib/students/birthday";

/**
 * Nhắc giáo viên tổ chức sinh nhật ngay trên màn điểm danh của buổi.
 *
 * Vì sao đặt ở đây: buổi tổ chức có thể KHÔNG rơi đúng ngày sinh nhật (hôm đó lớp
 * nghỉ) — giáo viên không thể tự suy ra từ ngày sinh trong hồ sơ. Banner nói thẳng
 * buổi này là buổi được chọn.
 */
export function BirthdayBanner({ items }: { items: SessionBirthday[] }) {
  if (items.length === 0) return null;
  return (
    <div className="mb-4 flex items-start gap-3 rounded-xl border border-state-warning-soft bg-state-warning-soft p-4">
      <Cake className="mt-0.5 h-5 w-5 shrink-0 text-state-warning-ink" />
      <div className="min-w-0 text-sm text-state-warning-ink">
        <p className="font-semibold">Buổi này có tổ chức sinh nhật</p>
        <ul className="mt-1 space-y-0.5">
          {items.map((b) => (
            <li key={b.greetingId}>
              🎂 <strong>{b.studentName}</strong> — sinh nhật {b.birthdayText}
              {!b.onBirthday && (
                <span className="text-state-warning-ink">
                  {" "}
                  (tổ chức sớm, hôm sinh nhật lớp không học)
                </span>
              )}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
