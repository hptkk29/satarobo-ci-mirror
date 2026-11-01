"use client";

// Vỏ Sheet phải cho form mã ca. Trước đây form mở INLINE ngay trên đầu bảng, nên bấm "Sửa" ở dòng
// thứ 12 là bảng nhảy lên và người dùng mất dấu dòng mình đang sửa.
//
// Điều dễ vỡ: `key` trên `TemplateEditor` phải đổi theo bản ghi — form giữ state trong `useState`,
// không có `key` thì mở dòng khác vẫn thấy dữ liệu dòng cũ.
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { TemplateEditor, type TemplateCenter, type TemplateEditorValue } from "./template-editor";

export function TemplateSheet({
  open,
  onOpenChange,
  value,
  centers,
  canGlobal,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /** `null` = tạo mới; có giá trị = sửa bản ghi đó. */
  value: TemplateEditorValue | null;
  centers: TemplateCenter[];
  canGlobal: boolean;
  onSaved: () => void;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>{value?.id ? `Sửa mã ${value.code}` : "Thêm mã ca"}</SheetTitle>
          <SheetDescription>
            {value?.id
              ? "Đổi giờ/số công chỉ áp cho ô xếp SAU khi lưu — lịch đã xếp giữ nguyên."
              : "Khai đúng mã đang dùng trên Sheet để import không báo mã lạ."}
          </SheetDescription>
        </SheetHeader>
        <TemplateEditor
          key={value?.id ?? "new"}
          initial={value ?? undefined}
          centers={centers}
          canGlobal={canGlobal}
          onSaved={onSaved}
          onCancel={() => onOpenChange(false)}
        />
      </SheetContent>
    </Sheet>
  );
}
