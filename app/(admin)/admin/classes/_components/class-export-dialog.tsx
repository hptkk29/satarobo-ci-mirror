"use client";

import { useEffect, useState } from "react";
import { Download, Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  CLASS_EXPORT_COLUMNS,
  DEFAULT_CLASS_COLUMNS,
  classExportOptionsSchema,
  toClassExportQuery,
  type ClassExportColumn,
  type ClassExportOptions,
  type ExportSheet,
} from "@/lib/classes/class-export-options";
import { cn } from "@/lib/utils";

const KHOA_LUU = "satarobo:classes:export";

const MAC_DINH: ClassExportOptions = {
  sheets: ["lop"],
  columns: DEFAULT_CLASS_COLUMNS,
  rosterScope: "dang-hoc",
  parentContact: false,
  sessionScope: "tat-ca",
};

const SHEETS: { v: ExportSheet; label: string; mo: string }[] = [
  { v: "lop", label: "Danh sách lớp", mo: "Mỗi lớp một dòng, cột tuỳ chọn bên dưới." },
  { v: "hocvien", label: "Học viên theo lớp", mo: "Mỗi học viên của mỗi lớp một dòng." },
  { v: "buoi", label: "Lịch buổi học", mo: "Mỗi buổi của mỗi lớp một dòng." },
];

function Check({
  checked,
  onChange,
  children,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  children: React.ReactNode;
  disabled?: boolean;
}) {
  return (
    <label
      className={cn(
        "flex cursor-pointer items-start gap-2 text-sm",
        disabled && "cursor-not-allowed opacity-50",
      )}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 h-4 w-4 accent-[var(--primary)]"
      />
      <span>{children}</span>
    </label>
  );
}

function Radio<T extends string>({
  name,
  value,
  options,
  onChange,
}: {
  name: string;
  value: T;
  options: { v: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1">
      {options.map((o) => (
        <label key={o.v} className="flex cursor-pointer items-center gap-1.5 text-sm">
          <input
            type="radio"
            name={name}
            checked={value === o.v}
            onChange={() => onChange(o.v)}
            className="h-4 w-4 accent-[var(--primary)]"
          />
          {o.label}
        </label>
      ))}
    </div>
  );
}

/**
 * Nút + hộp thoại "Xuất Excel". Xuất ĐÚNG các lớp đang lọc trên màn (route dùng chung bộ
 * lọc `lib/classes/list-filter.ts`), với sheet/cột tuỳ chọn. Lựa chọn được nhớ theo máy.
 */
export function ClassExportDialog({
  filterQuery,
  classCount,
  canParentContact,
}: {
  /** Chuỗi query của bộ lọc đang áp dụng. */
  filterQuery: string;
  classCount: number;
  /** Có quyền xem danh sách học viên — mới được chọn kèm liên hệ phụ huynh. */
  canParentContact: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [o, setO] = useState<ClassExportOptions>(MAC_DINH);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(KHOA_LUU);
      if (!raw) return;
      const parsed = classExportOptionsSchema.safeParse(JSON.parse(raw));
      if (parsed.success) setO(parsed.data);
    } catch {
      /* dữ liệu nhớ hỏng/không đọc được — dùng mặc định */
    }
  }, []);

  const set = (patch: Partial<ClassExportOptions>) => setO((cur) => ({ ...cur, ...patch }));
  const toggleSheet = (s: ExportSheet, on: boolean) =>
    set({ sheets: on ? [...o.sheets, s] : o.sheets.filter((x) => x !== s) });
  const toggleCol = (c: ClassExportColumn, on: boolean) =>
    set({ columns: on ? [...o.columns, c] : o.columns.filter((x) => x !== c) });

  const valid = classExportOptionsSchema.safeParse(o);
  const loi = valid.success ? null : valid.error.issues[0]?.message;

  async function download() {
    if (!valid.success) return;
    const opts = {
      ...valid.data,
      parentContact: canParentContact && valid.data.parentContact,
    };
    try {
      window.localStorage.setItem(KHOA_LUU, JSON.stringify(opts));
    } catch {
      /* bỏ qua */
    }
    setBusy(true);
    try {
      const qs = [filterQuery, toClassExportQuery(opts)].filter(Boolean).join("&");
      const res = await fetch(`/api/admin/classes/export?${qs}`);
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        toast.error(body?.error ?? `Xuất thất bại (${res.status})`);
        return;
      }
      const blob = await res.blob();
      const cd = res.headers.get("Content-Disposition") ?? "";
      const name = /filename="([^"]+)"/.exec(cd)?.[1] ?? "lop-hoc.xlsx";
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast.success(`Đã xuất ${name}`);
      setOpen(false);
    } catch {
      toast.error("Không tải được file — kiểm tra kết nối rồi thử lại.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={classCount === 0}
        title={classCount === 0 ? "Không có lớp nào để xuất" : undefined}
        className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-4 py-2 text-sm font-semibold text-foreground hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
      >
        <Download className="h-4 w-4" />
        Xuất Excel
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Xuất danh sách lớp</DialogTitle>
            <DialogDescription>
              Xuất <b className="text-foreground">{classCount} lớp</b> đang hiển thị theo bộ lọc
              hiện tại ra một file Excel.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-5">
            <section className="space-y-2">
              <h3 className="text-sm font-semibold">Nội dung (mỗi mục một sheet)</h3>
              {SHEETS.map((s) => (
                <Check
                  key={s.v}
                  checked={o.sheets.includes(s.v)}
                  onChange={(v) => toggleSheet(s.v, v)}
                >
                  <span className="font-medium">{s.label}</span>
                  <span className="block text-xs text-muted-foreground">{s.mo}</span>
                </Check>
              ))}
            </section>

            {o.sheets.includes("lop") && (
              <section className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold">Cột của sheet “Danh sách lớp”</h3>
                  <div className="flex gap-1 text-xs">
                    <button
                      type="button"
                      className="rounded px-2 py-1 font-semibold text-primary hover:bg-muted"
                      onClick={() => set({ columns: CLASS_EXPORT_COLUMNS.map((c) => c.key) })}
                    >
                      Chọn hết
                    </button>
                    <button
                      type="button"
                      className="rounded px-2 py-1 font-semibold text-muted-foreground hover:bg-muted"
                      onClick={() => set({ columns: DEFAULT_CLASS_COLUMNS })}
                    >
                      Mặc định
                    </button>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 sm:grid-cols-3">
                  {CLASS_EXPORT_COLUMNS.map((c) => (
                    <Check
                      key={c.key}
                      checked={o.columns.includes(c.key)}
                      onChange={(v) => toggleCol(c.key, v)}
                    >
                      {c.label}
                    </Check>
                  ))}
                </div>
              </section>
            )}

            {o.sheets.includes("hocvien") && (
              <section className="space-y-2">
                <h3 className="text-sm font-semibold">Học viên</h3>
                <Radio
                  name="hv"
                  value={o.rosterScope}
                  onChange={(v) => set({ rosterScope: v })}
                  options={[
                    { v: "dang-hoc", label: "Chỉ học viên đang thuộc lớp" },
                    { v: "tat-ca", label: "Kể cả đã nghỉ / chuyển / hoàn thành" },
                  ]}
                />
                <Check
                  checked={canParentContact && o.parentContact}
                  disabled={!canParentContact}
                  onChange={(v) => set({ parentContact: v })}
                >
                  Kèm tên + SĐT phụ huynh
                  <span className="block text-xs text-muted-foreground">
                    {canParentContact
                      ? "SĐT bị che nếu tài khoản không có quyền xem thông tin cá nhân. Lượt xuất được ghi nhật ký."
                      : "Tài khoản của bạn không có quyền xem danh sách học viên."}
                  </span>
                </Check>
              </section>
            )}

            {o.sheets.includes("buoi") && (
              <section className="space-y-2">
                <h3 className="text-sm font-semibold">Buổi học</h3>
                <Radio
                  name="buoi"
                  value={o.sessionScope}
                  onChange={(v) => set({ sessionScope: v })}
                  options={[
                    { v: "tat-ca", label: "Tất cả buổi" },
                    { v: "da-day", label: "Đã dạy" },
                    { v: "sap-toi", label: "Sắp tới" },
                  ]}
                />
              </section>
            )}

            {loi && <p className="text-sm text-state-danger-ink">{loi}</p>}
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Huỷ
            </Button>
            <Button type="button" onClick={download} disabled={!valid.success || busy}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
              {busy ? "Đang xuất…" : "Tải file Excel"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
