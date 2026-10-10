"use client";

import { useState } from "react";
import { Info } from "lucide-react";

/**
 * Dấu ⓘ — bấm ra lời giải thích.
 *
 * Cố ý KHÔNG dùng `title=""`: điện thoại không hover được, mà đây đúng là chỗ người dùng
 * cần giải thích nhất. Chủ dự án 14/09: "hãy là 1 icon chữ i hình tròn để ghi chú rõ ràng
 * hơn".
 *
 * Ở CHUNG một file vì đã có HAI màn cần nó (chính sách hoa hồng · hoàn tiền chờ đề xuất).
 * Bản chép tay thứ hai là bản sẽ lệch: một bên vá a11y, bên kia không, và không gì báo.
 */
export function ChuThich({
  noiDung,
  nhan,
}: {
  noiDung: string;
  nhan: string;
}) {
  const [mo, setMo] = useState(false);
  return (
    <span className="relative inline-flex">
      <button
        type="button"
        onClick={() => setMo((v) => !v)}
        onBlur={() => setMo(false)}
        aria-label={nhan}
        aria-expanded={mo}
        className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-foreground"
      >
        <Info className="h-3.5 w-3.5" aria-hidden />
      </button>
      {mo && (
        <span
          role="tooltip"
          // `whitespace-normal break-words` KHÔNG thừa: `TableCell` của repo đặt
          // `whitespace-nowrap` (components/ui/table.tsx:86), nên trong bảng lời giải
          // thích tràn ra một dòng và bị cắt mất đuôi — mở ra được mà đọc không được,
          // đúng kiểu affordance nói dối (luật 12). Đo thật ở màn Hoàn tiền 14/09.
          className="absolute left-0 top-6 z-30 w-[min(22rem,80vw)] whitespace-normal break-words rounded-lg border border-border bg-card p-3 text-xs leading-relaxed text-foreground shadow-md"
        >
          {noiDung}
        </span>
      )}
    </span>
  );
}
