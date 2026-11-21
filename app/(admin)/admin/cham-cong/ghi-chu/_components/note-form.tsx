"use client";

// Form khai một ghi chú lịch, mở trong Sheet phải.
//
// Vì sao tách khỏi bảng: bản cũ mở form INLINE ở đầu trang, nên bấm sửa một dòng là hai bảng nhảy
// chỗ và người dùng mất dấu dòng đang sửa. Sheet giữ nguyên bảng phía sau.
//
// Hai điều dễ vỡ:
//  · "Theo thứ" và "Theo ngày" là LOẠI TRỪ nhau — server `refine` bắt đúng một trong hai, gửi cả
//    hai (hay không gửi cái nào) là lỗi "Chọn ĐÚNG MỘT". Ở đây một nhóm radio quyết định, ô còn lại
//    được gửi là `null`, không phải chuỗi rỗng.
//  · Nội dung bắt buộc TRỪ khi cách gửi là "Không gửi tin" — chặn ngay ở đây để người dùng không
//    phải đi một vòng server mới biết thiếu chữ.
import { useState, useTransition } from "react";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { BTN_DANGER, BTN_OUTLINE, BTN_PRIMARY, FIELD } from "@/components/admin/cham-cong/classes";
import { deleteBriefNoteAction, saveBriefNoteAction } from "../_actions";
import { AUD_LABEL, MODE_LABEL, WD, WD_FULL, type NoteBlock, type NoteRow } from "./shared";

const LABEL = "mb-1 block text-sm font-semibold text-foreground";

export function NoteForm({
  open,
  onOpenChange,
  blocks,
  value,
  preset,
  gioGui,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /** CHỈ khối người dùng xếp được — server cũng chặn, nhưng đừng bày lựa chọn sẽ bị từ chối. */
  blocks: NoteBlock[];
  /** `null` = thêm mới. */
  value: NoteRow | null;
  /** Điền sẵn khi bấm ô trống trong ma trận: khối + thứ. `weekday: null` = thêm ghi đè theo ngày. */
  preset: { centerId: string; weekday: number | null } | null;
  gioGui: string;
  onSaved: () => void;
}) {
  const [pending, start] = useTransition();
  const [centerId, setCenterId] = useState(() => {
    const wanted = value?.centerId ?? preset?.centerId;
    return blocks.some((b) => b.id === wanted) ? (wanted as string) : blocks[0].id;
  });
  const [kind, setKind] = useState<"weekday" | "date">(() => {
    if (value) return value.date ? "date" : "weekday";
    return preset && preset.weekday !== null ? "weekday" : "date";
  });
  const [weekday, setWeekday] = useState<number>(value?.weekday ?? preset?.weekday ?? 1);
  const [date, setDate] = useState<string>(value?.date ?? "");
  const [audience, setAudience] = useState<NoteRow["audience"]>(value?.audience ?? "ALL");
  const [mode, setMode] = useState<NoteRow["mode"]>(value?.mode ?? "APPEND");
  const [text, setText] = useState(value?.text ?? "");
  const [isActive, setIsActive] = useState(value?.isActive ?? true);
  const [loi, setLoi] = useState<string | null>(null);
  const [xacNhanXoa, setXacNhanXoa] = useState(false);

  const canThieuNoiDung = mode !== "SUPPRESS";

  function luu(e: React.FormEvent) {
    e.preventDefault();
    const noiDung = text.trim();
    if (kind === "date" && !date) {
      setLoi("Chọn ngày áp dụng.");
      return;
    }
    if (canThieuNoiDung && !noiDung) {
      setLoi('Nhập nội dung, hoặc chọn cách gửi "Không gửi tin".');
      return;
    }
    setLoi(null);
    start(async () => {
      const r = await saveBriefNoteAction({
        ...(value?.id ? { id: value.id } : {}),
        centerId,
        weekday: kind === "weekday" ? weekday : null,
        date: kind === "date" ? date : null,
        audience,
        mode,
        text: noiDung,
        isActive,
      });
      if (!r.ok) {
        setLoi(r.error);
        toast.error(r.error);
        return;
      }
      toast.success(value?.id ? "Đã lưu ghi chú" : "Đã thêm ghi chú");
      onSaved();
    });
  }

  function xoa() {
    if (!value?.id) return;
    start(async () => {
      const r = await deleteBriefNoteAction(value.id);
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      toast.success("Đã xoá ghi chú");
      onSaved();
    });
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>{value?.id ? "Sửa ghi chú lịch" : "Thêm ghi chú lịch"}</SheetTitle>
          <SheetDescription>
            Nội dung ghép vào tin nhắc lịch gửi lúc <span className="tabular-nums">{gioGui}</span> hôm
            trước. Ghi chú theo ngày được gửi CÙNG việc cố định của thứ đó — muốn thay hẳn nội dung
            thì chọn cách gửi “Thay toàn bộ”.
          </SheetDescription>
        </SheetHeader>

        <form onSubmit={luu} className="flex min-h-0 flex-1 flex-col">
          <fieldset disabled={pending} aria-busy={pending || undefined} className="space-y-4 px-4">
            <div>
              <label htmlFor="ghichu-khoi" className={LABEL}>
                Khối
              </label>
              <select
                id="ghichu-khoi"
                className={cn(FIELD, "w-full")}
                value={centerId}
                onChange={(e) => setCenterId(e.target.value)}
              >
                {blocks.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.label}
                  </option>
                ))}
              </select>
            </div>

            <fieldset>
              <legend className={LABEL}>Áp dụng</legend>
              <div className="flex flex-wrap gap-4">
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="radio"
                    name="ghichu-kind"
                    className="h-4 w-4 accent-primary"
                    checked={kind === "weekday"}
                    onChange={() => setKind("weekday")}
                  />
                  Lặp theo thứ (việc cố định)
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="radio"
                    name="ghichu-kind"
                    className="h-4 w-4 accent-primary"
                    checked={kind === "date"}
                    onChange={() => setKind("date")}
                  />
                  Một ngày cụ thể (ghi đè)
                </label>
              </div>
            </fieldset>

            {kind === "weekday" ? (
              <div>
                <label htmlFor="ghichu-thu" className={LABEL}>
                  Thứ
                </label>
                <select
                  id="ghichu-thu"
                  className={cn(FIELD, "w-full")}
                  value={weekday}
                  onChange={(e) => setWeekday(Number(e.target.value))}
                >
                  {WD.map((w) => (
                    <option key={w} value={w}>
                      {WD_FULL[w]}
                    </option>
                  ))}
                </select>
              </div>
            ) : (
              <div>
                <label htmlFor="ghichu-ngay" className={LABEL}>
                  Ngày <span className="text-state-danger-ink">*</span>
                </label>
                <input
                  id="ghichu-ngay"
                  type="date"
                  required
                  className={cn(FIELD, "w-full")}
                  value={date}
                  aria-invalid={loi !== null && !date ? true : undefined}
                  onChange={(e) => setDate(e.target.value)}
                />
              </div>
            )}

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="ghichu-gui-cho" className={LABEL}>
                  Gửi cho
                </label>
                <select
                  id="ghichu-gui-cho"
                  className={cn(FIELD, "w-full")}
                  value={audience}
                  onChange={(e) => setAudience(e.target.value as NoteRow["audience"])}
                >
                  {(Object.keys(AUD_LABEL) as NoteRow["audience"][]).map((a) => (
                    <option key={a} value={a}>
                      {AUD_LABEL[a]}
                    </option>
                  ))}
                </select>
                <p className="mt-1 text-xs text-muted-foreground">
                  Lọc theo nhóm ghi trong khung ca tuần của từng người.
                </p>
              </div>

              <div>
                <label htmlFor="ghichu-cach-gui" className={LABEL}>
                  Cách gửi
                </label>
                <select
                  id="ghichu-cach-gui"
                  className={cn(FIELD, "w-full")}
                  value={mode}
                  onChange={(e) => setMode(e.target.value as NoteRow["mode"])}
                >
                  {(Object.keys(MODE_LABEL) as NoteRow["mode"][]).map((m) => (
                    <option key={m} value={m}>
                      {MODE_LABEL[m]}
                    </option>
                  ))}
                </select>
                <p className="mt-1 text-xs text-muted-foreground">
                  {mode === "APPEND" && "Thêm một dòng vào cuối tin nhắc lịch."}
                  {mode === "REPLACE" && "Thay toàn bộ nội dung tin của khối hôm đó."}
                  {mode === "SUPPRESS" && "Không gửi tin cho khối hôm đó — trừ khi có mục Thay toàn bộ."}
                </p>
              </div>
            </div>

            <div>
              <label htmlFor="ghichu-noi-dung" className={LABEL}>
                Nội dung {canThieuNoiDung && <span className="text-state-danger-ink">*</span>}
              </label>
              <textarea
                id="ghichu-noi-dung"
                maxLength={500}
                rows={4}
                className={cn(FIELD, "h-auto w-full py-2")}
                value={text}
                aria-invalid={loi !== null && canThieuNoiDung && !text.trim() ? true : undefined}
                placeholder="VD: 15:00–16:00 HỌP TỔNG KẾT TUẦN (60 phút) — có mặt đầy đủ"
                onChange={(e) => setText(e.target.value)}
              />
              <p className="mt-1 text-xs text-muted-foreground tabular-nums">{text.length}/500 ký tự</p>
            </div>

            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="h-4 w-4 accent-primary"
                checked={isActive}
                onChange={(e) => setIsActive(e.target.checked)}
              />
              Đang dùng — bỏ chọn để tạm tắt mà không xoá
            </label>

            {loi && (
              <p role="alert" className="text-sm font-medium text-state-danger-ink">
                {loi}
              </p>
            )}
          </fieldset>

          <SheetFooter className="flex-row flex-wrap items-center gap-2 border-t border-border bg-muted/50">
            <button type="submit" className={BTN_PRIMARY} disabled={pending}>
              {value?.id ? "Lưu" : "Thêm ghi chú"}
            </button>
            <button type="button" className={BTN_OUTLINE} disabled={pending} onClick={() => onOpenChange(false)}>
              Huỷ
            </button>
            {value?.id &&
              (xacNhanXoa ? (
                <button
                  type="button"
                  className={cn(BTN_DANGER, "ml-auto")}
                  disabled={pending}
                  onClick={xoa}
                  aria-label="Xác nhận xoá vĩnh viễn ghi chú này"
                >
                  Xoá hẳn?
                </button>
              ) : (
                <button
                  type="button"
                  className={cn(BTN_OUTLINE, "ml-auto")}
                  disabled={pending}
                  onClick={() => setXacNhanXoa(true)}
                  aria-label="Xoá ghi chú này"
                >
                  <Trash2 aria-hidden className="h-4 w-4" />
                  Xoá
                </button>
              ))}
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}
