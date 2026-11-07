"use client";

// components/admin/cham-cong/shift-cell-picker.tsx — một Ô của lưới phân ca, bấm là đổi mã ca.
//
// Vì sao file này tồn tại: lưới cũ đổi ca bằng `<select>` nhét trong ô 44px — danh sách 20 mã tràn
// ra ngoài, không thấy tên ca lẫn giờ, và không có đường "xoá ca". Ở đây ô là NÚT mở menu: mã +
// tên + giờ + nơi làm nằm cùng một dòng, và hai việc hiếm ("Xoá ca", "Chọn kèm lý do…") tách hẳn
// xuống dưới để không bấm nhầm.
//
// Dùng `components/ui/dropdown-menu.tsx` (base-ui Menu) — repo KHÔNG có `popover.tsx` và đặc tả
// cấm thêm thư viện. Ô NHẬP LÝ DO không được nằm trong menu (menu nuốt phím và tự đóng khi mất
// focus) ⇒ nó ở một `Dialog` riêng.
//
// Đổi ca là ghi thẳng vào lịch của người khác nên KHÔNG có "Hoàn tác": nơi gọi phải tự `refresh()`
// sau khi action trả về, và ô nào của khối khác thì truyền `disabled` để chỉ còn đọc.
import { useState } from "react";
import { Check, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ShiftCodeChip, type ShiftSource } from "@/components/cham-cong/ui/shift-code-chip";
import { BTN_OUTLINE, BTN_PRIMARY, FIELD } from "./classes";

export type ShiftCellCode = {
  code: string;
  name: string;
  /** Giờ đã format ở server, vd "07:45–17:00". */
  timeLabel: string;
  /** Nơi làm đã đổi sang nhãn tiếng Việt, vd "Tại cơ sở". */
  place: string;
  /** `ShiftTemplate.isLeave` — quyết định mã nằm nhóm "Nghỉ". Thiếu thì suy từ X/P (K-01). */
  isLeave?: boolean;
};

const TRIGGER =
  "flex h-8 w-12 items-center justify-center rounded-md border border-transparent transition-colors hover:border-border";

function isOff(c: ShiftCellCode): boolean {
  return c.isLeave ?? (c.code === "X" || c.code === "P");
}

export function ShiftCellPicker({
  value,
  source,
  codes,
  disabled,
  disabledReason = "Chỉ xem — bạn không có quyền xếp ca ở khối này",
  busy,
  hideReason,
  triggerLabel,
  menuTitle,
  onPick,
}: {
  value: string | null;
  source?: ShiftSource;
  codes: ShiftCellCode[];
  /** Ô của khối khác / người chỉ xem: hiện chip trần, không mở được menu. */
  disabled?: boolean;
  disabledReason?: string;
  /** Đang chờ action trả về — khoá ô để không bấm hai lần vào cùng một ngày. */
  busy?: boolean;
  /**
   * Ẩn nhánh "Chọn kèm lý do…" (mặc định HIỆN — lưới phân ca tháng vẫn cần nó).
   * Bật ở lưới khung ca tuần: `savePatternCellAction` KHÔNG nhận `note` (zod bỏ im lặng),
   * nên bày ô nhập lý do ở đó là hứa một thứ không được lưu.
   */
  hideReason?: boolean;
  /** `aria-label` của nút, vd "Chọn ca cho Nguyễn A ngày T4 09/09". */
  triggerLabel: string;
  /** Tiêu đề trong menu, vd "Nguyễn A · T4 09/09". Không truyền thì lấy `triggerLabel`. */
  menuTitle?: string;
  onPick: (code: string | null, note?: string) => void;
}) {
  const [reasonOpen, setReasonOpen] = useState(false);
  const [pickCode, setPickCode] = useState<string>(value ?? codes[0]?.code ?? "");
  const [note, setNote] = useState("");

  if (disabled) {
    return (
      <span className="flex h-8 w-12 items-center justify-center" title={disabledReason}>
        <ShiftCodeChip code={value} source={source} size="sm" />
      </span>
    );
  }

  const work = codes.filter((c) => !isOff(c));
  const off = codes.filter((c) => isOff(c));

  const row = (c: ShiftCellCode) => {
    const current = c.code === value;
    return (
      <DropdownMenuItem
        key={c.code}
        onClick={() => onPick(c.code)}
        className={cn("h-9 text-sm", current && "bg-primary-soft")}
      >
        <span className="w-9 shrink-0 font-mono font-semibold">{c.code}</span>
        <span className="min-w-0 flex-1 truncate">{c.name}</span>
        <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
          {c.timeLabel}
          {c.place ? ` · ${c.place}` : ""}
        </span>
        {current && <Check aria-hidden className="h-4 w-4 shrink-0" />}
      </DropdownMenuItem>
    );
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label={triggerLabel}
          aria-busy={busy || undefined}
          disabled={busy}
          className={cn(TRIGGER, busy && "opacity-50")}
        >
          <ShiftCodeChip code={value} source={source} size="sm" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-72 min-w-72">
          {/* Group BẮT BUỘC quanh mọi Label: `DropdownMenuLabel` là Menu.GroupLabel của
              base-ui và nó THROW nếu không có Group bọc ngoài (sự cố prod 10/07). */}
          <DropdownMenuGroup>
            <DropdownMenuLabel className="truncate text-xs font-semibold text-foreground">
              {menuTitle ?? triggerLabel}
            </DropdownMenuLabel>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />

          {work.length > 0 && (
            <DropdownMenuGroup>
              <DropdownMenuLabel>Làm việc</DropdownMenuLabel>
              {work.map(row)}
            </DropdownMenuGroup>
          )}
          {off.length > 0 && (
            <DropdownMenuGroup>
              <DropdownMenuLabel>Nghỉ</DropdownMenuLabel>
              {off.map(row)}
            </DropdownMenuGroup>
          )}

          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={() => onPick(null)}
            className="h-9 text-sm text-state-danger-ink"
          >
            <Trash2 aria-hidden className="h-4 w-4" />
            Xoá ca
          </DropdownMenuItem>
          {!hideReason && (
            <DropdownMenuItem onClick={() => setReasonOpen(true)} className="h-9 text-sm">
              Chọn kèm lý do…
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={reasonOpen && !hideReason} onOpenChange={setReasonOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Chọn ca kèm lý do</DialogTitle>
          </DialogHeader>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!pickCode) return;
              onPick(pickCode, note.trim() || undefined);
              setReasonOpen(false);
              setNote("");
            }}
          >
            <label htmlFor="shift-cell-code" className="mb-1 block text-sm font-semibold">
              Mã ca
            </label>
            {/* `<select>` thuần: `SelectValue` của base-ui in GIÁ TRỊ THÔ chứ không tra nhãn. */}
            <select
              id="shift-cell-code"
              value={pickCode}
              onChange={(e) => setPickCode(e.target.value)}
              className={cn(FIELD, "mb-3 w-full")}
            >
              {codes.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.code} — {c.name}
                </option>
              ))}
            </select>

            <label htmlFor="shift-cell-note" className="mb-1 block text-sm font-semibold">
              Lý do
            </label>
            <input
              id="shift-cell-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={200}
              className={cn(FIELD, "w-full")}
              placeholder="Đổi ca giúp đồng nghiệp nghỉ ốm…"
            />

            <DialogFooter className="mt-4">
              <button
                type="button"
                onClick={() => setReasonOpen(false)}
                className={BTN_OUTLINE}
              >
                Huỷ
              </button>
              <button type="submit" className={BTN_PRIMARY} disabled={!pickCode}>
                Lưu
              </button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
