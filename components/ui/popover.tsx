"use client"

import { Popover as PopoverPrimitive } from "@base-ui/react/popover"

import { cn } from "@/lib/utils"
import { useLopPhamViPortal } from "@/components/ui/lop-pham-vi-portal"

/**
 * Popover — hộp nổi nhỏ bấm mới mở, khác Tooltip ở chỗ NỘI DUNG ĐƯỢC TƯƠNG TÁC (có nút, link, chọn).
 *
 * Bọc `@base-ui/react/popover` (đã là dependency — không thêm thư viện). Cấu trúc theo `tooltip.tsx`:
 * Portal → Positioner → Popup. Esc đóng và trả focus về nút mở là do base-ui lo; không tự viết lại.
 *
 * Dùng khi: cần khung nhỏ có nút/đường dẫn (ví dụ "Xem cách xử lý" kèm liên kết). Hướng dẫn chỉ-đọc ngắn
 * cho một ô thì dùng `HelpHint`/`InfoTip` (Tooltip, mở được bằng hover + focus + bấm).
 */
function Popover({ ...props }: PopoverPrimitive.Root.Props) {
  return <PopoverPrimitive.Root data-slot="popover" {...props} />
}

function PopoverTrigger({ ...props }: PopoverPrimitive.Trigger.Props) {
  return <PopoverPrimitive.Trigger data-slot="popover-trigger" {...props} />
}

function PopoverContent({
  className,
  side = "bottom",
  sideOffset = 6,
  align = "center",
  alignOffset = 0,
  children,
  ...props
}: PopoverPrimitive.Popup.Props &
  Pick<
    PopoverPrimitive.Positioner.Props,
    "align" | "alignOffset" | "side" | "sideOffset"
  >) {
  const lopPhamVi = useLopPhamViPortal()
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Positioner
        align={align}
        alignOffset={alignOffset}
        side={side}
        sideOffset={sideOffset}
        className="isolate z-50"
      >
        <PopoverPrimitive.Popup
          data-slot="popover-content"
          className={cn(
            lopPhamVi,
            // Rộng tối đa 20rem nhưng KHÔNG bao giờ vượt bề ngang màn (trừ lề 1rem mỗi bên) — ở 320px vẫn đọc được.
            "z-50 w-max max-w-[min(20rem,calc(100vw-2rem))] origin-(--transform-origin) rounded-lg bg-popover p-3 text-sm leading-relaxed text-popover-foreground shadow-md ring-1 ring-foreground/10 outline-none transition-opacity duration-150 data-ending-style:opacity-0 data-starting-style:opacity-0",
            className
          )}
          {...props}
        >
          {children}
        </PopoverPrimitive.Popup>
      </PopoverPrimitive.Positioner>
    </PopoverPrimitive.Portal>
  )
}

function PopoverTitle({ className, ...props }: PopoverPrimitive.Title.Props) {
  return (
    <PopoverPrimitive.Title
      data-slot="popover-title"
      className={cn("text-sm font-semibold text-foreground", className)}
      {...props}
    />
  )
}

function PopoverDescription({
  className,
  ...props
}: PopoverPrimitive.Description.Props) {
  return (
    <PopoverPrimitive.Description
      data-slot="popover-description"
      className={cn("text-sm text-muted-foreground", className)}
      {...props}
    />
  )
}

function PopoverClose({ ...props }: PopoverPrimitive.Close.Props) {
  return <PopoverPrimitive.Close data-slot="popover-close" {...props} />
}

export {
  Popover,
  PopoverClose,
  PopoverContent,
  PopoverDescription,
  PopoverTitle,
  PopoverTrigger,
}
