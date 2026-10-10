// app/(admin)/admin/cham-cong/phan-ca/import/_components/stepper.tsx — ba bước của lượt import.
//
// Vì sao file này tồn tại: bản cũ bày CẢ BỐN thẻ cùng lúc ("chọn file", "ánh xạ", "chọn phần cần
// áp", "kết quả") nên người nhập không biết mình đang ở đâu, và bấm "Áp vào hệ thống" khi mới đọc
// file xong trông y hệt bấm sau khi đã soát ánh xạ. Ba ô dưới đây nói rõ bước hiện tại, và ô đã
// xong mang dấu Check để lượt import dở dang không bị nhầm là đã áp.
//
// Điều dễ vỡ: đây là CHỈ BÁO, không phải nút — bước 2 và 3 không bấm quay lại được vì mỗi bước
// phụ thuộc kết quả server của bước trước (file phải được gửi lại và parse lại). Đừng biến `<li>`
// thành `<button>` nếu chưa có đường dựng lại trạng thái.
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

export type StepItem = {
  label: string;
  /** Một dòng tóm tắt kết quả của bước (tên file, số người, số ô đã áp). */
  hint?: string;
  state: "todo" | "current" | "done";
};

const STATE_CLASS: Record<StepItem["state"], string> = {
  todo: "border-border text-muted-foreground",
  current: "border-primary font-semibold text-primary-ink",
  done: "border-state-success text-foreground",
};

export function Stepper({ items }: { items: StepItem[] }) {
  return (
    <ol aria-label="Ba bước import lịch" className="mb-4 flex gap-1">
      {items.map((s) => (
        <li
          key={s.label}
          aria-current={s.state === "current" ? "step" : undefined}
          className={cn("flex-1 border-b-2 px-3 py-2 text-sm transition-colors", STATE_CLASS[s.state])}
        >
          <span className="flex items-center gap-1.5">
            {s.state === "done" && <Check aria-hidden className="h-4 w-4 shrink-0 text-state-success-ink" />}
            <span className="truncate">{s.label}</span>
          </span>
          {s.hint && (
            <span className="mt-0.5 block truncate text-xs font-normal text-muted-foreground" title={s.hint}>
              {s.hint}
            </span>
          )}
        </li>
      ))}
    </ol>
  );
}
