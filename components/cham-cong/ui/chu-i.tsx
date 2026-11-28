"use client";

// components/cham-cong/ui/chu-i.tsx — chữ "i" nhỏ: chạm/bấm/rê chuột/Tab tới là hiện lời giải thích.
//
// Vì sao có (chủ dự án 06/10/2026: *"thêm chữ i nhỏ giải thích cho từng trường hợp đơn cho người
// dùng đỡ thắc mắc"*). Khuôn lấy từ `components/admin/ui/help-hint.tsx` — bản đó đủ hover + focus
// + chạm, nhưng nằm ở `components/admin/**` mà thư mục này (site GV mount chung) CẤM import.
//
// Ba điểm khác HelpHint, đều vì người dùng ở đây cầm ĐIỆN THOẠI:
//  1. Vùng chạm 44px. Biểu tượng chỉ 16px; lớp `after:` phủ quanh nó ra 44×44 mà không đẩy
//     bố cục — ngón tay không phải ngắm vào một chấm 14px như HelpHint.
//  2. `stopPropagation` khi bấm: chữ "i" đặt trên dòng bảng bấm-được (`/don-tu`) và trên thẻ chọn
//     loại đơn. Không chặn thì chạm "i" để đọc lại MỞ ĐƠN / ĐỔI LOẠI ĐƠN — lời hứa "đọc giải
//     thích" thành một thao tác khác (luật 12).
//  3. Bọc nội dung nhiều đoạn (Dùng khi · Cần điền · Khi duyệt · Lưu ý), canh trái, rộng 20rem.
//
// Như HelpHint: `type="button"` (nằm trong form), tự giữ state `open` để chạm mở được (base-ui
// mặc định đóng tooltip khi bấm trigger), tự bọc `TooltipProvider` (layout GV/admin không có).
// Token: CHỈ `:root` — tooltip dùng `bg-foreground text-background` của primitive.
import * as React from "react";
import { Info } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export function ChuI({
  children,
  label,
  side = "top",
  className,
}: {
  /** Nội dung giải thích — viết cho người dùng cuối, không ghi chú kỹ thuật. */
  children: React.ReactNode;
  /** aria-label của nút, vd "Giải thích: Nghỉ phép". BẮT BUỘC — nút chỉ có biểu tượng. */
  label: string;
  side?: "top" | "right" | "bottom" | "left";
  /** Class đắp lên NÚT. */
  className?: string;
}) {
  const [open, setOpen] = React.useState(false);
  return (
    <TooltipProvider>
      <Tooltip open={open} onOpenChange={setOpen}>
        <TooltipTrigger
          type="button"
          aria-label={label}
          closeOnClick={false}
          onClick={(e) => {
            e.stopPropagation();
            setOpen(true);
          }}
          className={cn(
            "relative inline-flex size-6 shrink-0 cursor-help items-center justify-center rounded-full align-middle text-muted-foreground transition-colors after:absolute after:-inset-2.5 after:content-[''] hover:text-primary focus-visible:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            className,
          )}
        >
          <Info className="size-4" aria-hidden />
        </TooltipTrigger>
        <TooltipContent
          side={side}
          className="max-w-[20rem] flex-col items-start gap-1.5 whitespace-normal text-left leading-relaxed"
        >
          {children}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
