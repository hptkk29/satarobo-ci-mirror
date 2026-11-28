"use client";

// components/admin/link-gioi-thieu/goi-y.tsx — dấu «?» tím cạnh tiêu đề mục ở màn «Link giới thiệu của tôi»; hover / focus / chạm ⇒ bong bóng trắng có viền (đúng thiết kế 21/11/2026).
// Cùng cách giữ trạng thái mở như `HelpHint` (bấm được trên cảm ứng, `type="button"`), chỉ khác kiểu bong bóng: nền thẻ + viền thay cho nền tối.
import * as React from "react";
import { Tooltip as TooltipPrimitive } from "@base-ui/react/tooltip";
import { CircleHelp } from "lucide-react";

export function GoiY({ children, nhan }: { children: React.ReactNode; nhan: string }) {
  const [mo, setMo] = React.useState(false);
  return (
    <TooltipPrimitive.Provider>
      <TooltipPrimitive.Root open={mo} onOpenChange={setMo}>
        <TooltipPrimitive.Trigger
          type="button"
          aria-label={nhan}
          closeOnClick={false}
          onClick={() => setMo(true)}
          className="relative inline-flex shrink-0 cursor-help items-center justify-center rounded-full text-primary transition-opacity hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 after:absolute after:-inset-[5px] pointer-coarse:after:-inset-[15px]"
        >
          <CircleHelp className="size-[18px]" aria-hidden />
        </TooltipPrimitive.Trigger>
        <TooltipPrimitive.Portal>
          <TooltipPrimitive.Positioner side="right" sideOffset={10} className="isolate z-50">
            <TooltipPrimitive.Popup className="z-50 max-w-[min(17rem,calc(100vw-2rem))] rounded-xl border border-border bg-card px-3.5 py-2.5 text-left text-sm leading-relaxed text-foreground shadow-md">
              <div>{children}</div>
            </TooltipPrimitive.Popup>
          </TooltipPrimitive.Positioner>
        </TooltipPrimitive.Portal>
      </TooltipPrimitive.Root>
    </TooltipPrimitive.Provider>
  );
}
