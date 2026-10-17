"use client";

import * as React from "react";
import { CircleHelp } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/**
 * Icon "?" cấp TỪNG MỤC / TỪNG Ô — hover (hoặc focus bàn phím, hoặc bấm) thì hiện
 * hướng dẫn ngắn.
 *
 * VÌ SAO CÓ. `<PageHelp>` giải thích cả TRANG, đóng sẵn ở đầu trang. Nhưng thứ người
 * vận hành vướng lại nằm ở một ô cụ thể ("Mã lớp nhập kiểu gì?", "Chọn 'Đã cọc' thì
 * hệ thống làm gì?"). Nhét lời giải thích đó vào PageHelp thì họ phải cuộn lên rồi
 * dò lại; viết thành dòng chữ mờ dưới mỗi ô thì form dài gấp đôi. ⇒ Một icon nhỏ
 * đứng ngay cạnh nhãn, chỉ bung ra khi người ta hỏi tới.
 *
 * KHÔNG dùng `title=""` của HTML: trình duyệt trễ 1–2 giây mới hiện, không style
 * được, và trên cảm ứng thì không bao giờ hiện.
 *
 * Ba điểm dễ vỡ đã xử lý sẵn ở đây:
 *
 * 1. `type="button"`. Các icon này sống TRONG `<form>`. Nút không khai type mặc định
 *    là `submit` ⇒ bấm "?" để đọc hướng dẫn lại thành gửi đơn/tạo lớp.
 *
 * 2. Mở được bằng CÁCH BẤM. Máy tính bảng / điện thoại không có "hover", mà base-ui
 *    mặc định còn ĐÓNG tooltip khi bấm trigger (`closeOnClick` = true). Nên ở đây tự
 *    giữ state `open`: tắt `closeOnClick` rồi mở tay trong `onClick`. Hover và focus
 *    bàn phím vẫn chạy đường của base-ui qua `onOpenChange`.
 *    (Chỉ mở chứ không toggle: trên chuột, hover đã mở sẵn rồi — toggle sẽ thành
 *    "bấm vào thì tắt", trông như hỏng. Đóng bằng cách chạm ra ngoài hoặc Esc.)
 *
 * 3. Tự bọc `TooltipProvider`. Layout admin KHÔNG có provider chung, và HelpHint
 *    phải cắm được vào bất kỳ form nào mà không bắt ai sửa layout. Provider lồng
 *    nhau vô hại — nó chỉ là nhóm chia sẻ độ trễ.
 */
export function HelpHint({
  children,
  label = "Xem hướng dẫn",
  side = "top",
  className,
}: {
  /** Nội dung hướng dẫn. Viết cho NGƯỜI VẬN HÀNH — không ghi chú kỹ thuật. */
  children: React.ReactNode;
  /** aria-label của nút — đọc cho người dùng trình đọc màn hình. */
  label?: string;
  side?: "top" | "right" | "bottom" | "left";
  /** Class đắp lên NÚT (không phải tooltip). Đổi cỡ icon: `[&_svg]:size-4`. */
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
          onClick={() => setOpen(true)}
          className={cn(
            "inline-flex shrink-0 cursor-help items-center justify-center rounded-full align-middle text-muted-foreground transition-colors hover:text-primary focus-visible:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30",
            className,
          )}
        >
          <CircleHelp className="size-3.5" aria-hidden />
        </TooltipTrigger>
        {/* max-w mặc định của TooltipContent là `max-w-xs` và căn giữa theo dòng —
            hợp với nhãn 3 chữ, KHÔNG hợp với hướng dẫn 2–3 câu. Đè lại ở đây để câu
            dài xuống dòng gọn và canh trái như một đoạn văn. */}
        <TooltipContent
          side={side}
          className="max-w-[18rem] items-start whitespace-normal text-left leading-relaxed"
        >
          {children}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

/**
 * Nhãn ô nhập của form admin, kèm dấu `*` bắt buộc và icon "?" tuỳ chọn.
 *
 * VÌ SAO CÓ. 40+ form admin đang chép tay đúng một khối
 * `<span className="mb-1 block …">{label}{required && *}</span>`. Gắn HelpHint vào
 * từng chỗ = sửa 40 file theo 40 kiểu khác nhau. Component này giữ NGUYÊN chuỗi class
 * đang dùng để thay thẳng vào chỗ cũ, không lệch một pixel nào so với ô bên cạnh.
 *
 * Icon dùng `inline-flex items-center` + `align-middle`: bài học cũ của repo là các
 * class kiểu `inline` / `mr-*` đắp lên icon trong nhãn dạng flex thì KHÔNG ăn.
 */
export function FieldLabel({
  label,
  hint,
  required,
  className,
  hintLabel,
}: {
  label: React.ReactNode;
  /** Có nội dung thì mới hiện icon "?". Bỏ trống = nhãn trơn như cũ. */
  hint?: React.ReactNode;
  required?: boolean;
  className?: string;
  /** aria-label riêng cho icon, mặc định "Xem hướng dẫn". */
  hintLabel?: string;
}) {
  return (
    <span
      className={cn("mb-1 block text-sm font-semibold text-foreground", className)}
    >
      {label}
      {required && <span className="ml-1 text-state-danger-ink">*</span>}
      {hint && (
        <HelpHint label={hintLabel} className="ml-1">
          {hint}
        </HelpHint>
      )}
    </span>
  );
}
