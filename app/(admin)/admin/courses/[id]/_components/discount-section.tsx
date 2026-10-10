"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus, Pencil, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import type { CourseDiscountType } from "@prisma/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MoneyInput } from "@/components/ui/money-input";
import { HelpHint } from "@/components/admin/ui/help-hint";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  createCourseDiscount,
  updateCourseDiscount,
  deleteCourseDiscount,
} from "../_actions";
import { PhanTrangBang } from "@/components/ui/phan-trang-bang";

export type DiscountRow = {
  id: string;
  type: CourseDiscountType;
  value: number;
  note: string | null;
  conditions: string | null;
  active: boolean;
  validFrom: string | null; // YYYY-MM-DD
  validTo: string | null; // YYYY-MM-DD
};

const TYPE_LABEL: Record<CourseDiscountType, string> = {
  AMOUNT: "Giảm số tiền (VND)",
  PERCENT: "Giảm phần trăm (%)",
  SCHOLARSHIP: "Học bổng (%)",
  PROGRAM: "Ưu đãi chương trình",
};

const TYPE_OPTIONS: CourseDiscountType[] = ["AMOUNT", "PERCENT", "SCHOLARSHIP", "PROGRAM"];

/** Dáng ô nhập của shadcn `<Input>` — đắp lên `<MoneyInput>` (vốn theo dáng form tự
 *  viết: cao hơn, nền bg-card) để hai ô cạnh nhau không lệch nhau. */
const SHADCN_INPUT_LOOK = "h-8 border-input bg-transparent py-1 pl-2.5";

function formatValue(d: DiscountRow): string {
  if (d.type === "AMOUNT") return `${d.value.toLocaleString("vi-VN")}đ`;
  if (d.type === "PERCENT" || d.type === "SCHOLARSHIP") return `${d.value}%`;
  return d.value.toLocaleString("vi-VN");
}

function formatDate(d: string | null): string {
  if (!d) return "—";
  const parts = d.split("-");
  if (parts.length !== 3) return d;
  return `${parts[2]}/${parts[1]}/${parts[0]}`;
}

type FormState = {
  type: CourseDiscountType;
  value: string;
  note: string;
  conditions: string;
  active: boolean;
  validFrom: string;
  validTo: string;
};

function emptyForm(): FormState {
  return {
    type: "PERCENT",
    value: "",
    note: "",
    conditions: "",
    active: true,
    validFrom: "",
    validTo: "",
  };
}

function rowToForm(d: DiscountRow): FormState {
  return {
    type: d.type,
    value: String(d.value),
    note: d.note ?? "",
    conditions: d.conditions ?? "",
    active: d.active,
    validFrom: d.validFrom ?? "",
    validTo: d.validTo ?? "",
  };
}

export function DiscountSection({
  courseId,
  discounts,
  canEdit,
}: {
  courseId: string;
  discounts: DiscountRow[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [editingId, setEditingId] = useState<string | null>(null); // null = chưa mở; "new" = tạo mới
  const [form, setForm] = useState<FormState>(emptyForm());
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  function openNew() {
    setForm(emptyForm());
    setEditingId("new");
  }

  function openEdit(d: DiscountRow) {
    setForm(rowToForm(d));
    setEditingId(d.id);
  }

  function closeForm() {
    setEditingId(null);
    setForm(emptyForm());
  }

  function submit() {
    const payload = {
      courseId,
      type: form.type,
      value: form.value,
      note: form.note,
      conditions: form.conditions,
      active: form.active,
      validFrom: form.validFrom,
      validTo: form.validTo,
    };
    startTransition(async () => {
      const r =
        editingId === "new"
          ? await createCourseDiscount(payload)
          : await updateCourseDiscount(editingId as string, payload);
      if (r.ok) {
        toast.success(editingId === "new" ? "Đã thêm ưu đãi" : "Đã cập nhật ưu đãi");
        closeForm();
        router.refresh();
      } else {
        toast.error(r.error ?? "Có lỗi xảy ra");
      }
    });
  }

  function onDelete(id: string) {
    // 2-click confirm
    if (confirmDeleteId !== id) {
      setConfirmDeleteId(id);
      return;
    }
    startTransition(async () => {
      const r = await deleteCourseDiscount(id);
      if (r.ok) {
        toast.success("Đã xoá ưu đãi");
        setConfirmDeleteId(null);
        router.refresh();
      } else {
        toast.error(r.error ?? "Có lỗi xảy ra");
      }
    });
  }

  return (
    <div className="rounded-xl border border-border bg-card shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-4">
        <div>
          <h2 className="flex items-center gap-1.5 text-lg font-semibold text-foreground">
            Ưu đãi
            <HelpHint>
              Cấu hình giảm giá / học bổng áp dụng toàn hệ thống cho khoá này.
            </HelpHint>
          </h2>
        </div>
        {canEdit && editingId === null && (
          <Button size="sm" onClick={openNew}>
            <Plus className="h-4 w-4" />
            Thêm ưu đãi
          </Button>
        )}
      </div>

      {/* Form thêm/sửa */}
      {canEdit && editingId !== null && (
        <div className="space-y-4 border-b border-border bg-muted/60 p-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="d-type">Loại ưu đãi</Label>
              <Select
                value={form.type}
                onValueChange={(v) => setForm((f) => ({ ...f, type: v as CourseDiscountType }))}
              >
                <SelectTrigger id="d-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TYPE_OPTIONS.map((t) => (
                    <SelectItem key={t} value={t}>
                      {TYPE_LABEL[t]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="d-value">
                Giá trị{" "}
                <span className="text-xs font-normal text-muted-foreground">
                  {form.type === "AMOUNT" ? "(VND)" : form.type === "PROGRAM" ? "" : "(%)"}
                </span>
              </Label>
              {/* Ô này ĐA NGHĨA theo loại ưu đãi: AMOUNT là SỐ TIỀN (cần chấm phân
                  cách), còn PERCENT/SCHOLARSHIP là PHẦN TRĂM — định dạng nghìn cho %
                  là sai. Nên chỉ đổi sang ô tiền đúng nhánh AMOUNT. */}
              {form.type === "AMOUNT" ? (
                <MoneyInput
                  id="d-value"
                  name="value"
                  min={0}
                  value={form.value}
                  onValueChange={(v) =>
                    setForm((f) => ({ ...f, value: v === null ? "" : String(v) }))
                  }
                  placeholder="500000"
                  // Kéo về đúng dáng <Input> shadcn để ô không đổi chiều cao/nền mỗi
                  // lần đổi loại ưu đãi. `pl-` chứ không `px-`: giữ chỗ cho chữ "đ".
                  className={SHADCN_INPUT_LOOK}
                />
              ) : (
                <Input
                  id="d-value"
                  type="number"
                  min={0}
                  value={form.value}
                  onChange={(e) => setForm((f) => ({ ...f, value: e.target.value }))}
                  placeholder="10"
                />
              )}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="d-note">Ghi chú</Label>
            <Input
              id="d-note"
              value={form.note}
              onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))}
              placeholder="vd: Ưu đãi đăng ký sớm"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="d-conditions">Điều kiện áp dụng</Label>
            <Textarea
              id="d-conditions"
              rows={2}
              value={form.conditions}
              onChange={(e) => setForm((f) => ({ ...f, conditions: e.target.value }))}
              placeholder="vd: Áp dụng cho học viên đăng ký combo 1&2"
            />
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="d-from">Hiệu lực từ</Label>
              <Input
                id="d-from"
                type="date"
                value={form.validFrom}
                onChange={(e) => setForm((f) => ({ ...f, validFrom: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="d-to">Hiệu lực đến</Label>
              <Input
                id="d-to"
                type="date"
                value={form.validTo}
                onChange={(e) => setForm((f) => ({ ...f, validTo: e.target.value }))}
              />
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Switch
              id="d-active"
              checked={form.active}
              onCheckedChange={(v) => setForm((f) => ({ ...f, active: v }))}
            />
            <Label htmlFor="d-active">Đang áp dụng</Label>
          </div>

          <div className="flex items-center gap-2">
            <Button size="sm" onClick={submit} disabled={isPending}>
              {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              {editingId === "new" ? "Thêm" : "Lưu"}
            </Button>
            <Button size="sm" variant="outline" onClick={closeForm} disabled={isPending}>
              <X className="h-4 w-4" />
              Huỷ
            </Button>
          </div>
        </div>
      )}

      {/* Danh sách */}
      <PhanTrangBang cuonNgang>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Loại</TableHead>
              <TableHead>Giá trị</TableHead>
              <TableHead>Ghi chú</TableHead>
              <TableHead>Hiệu lực</TableHead>
              <TableHead>Trạng thái</TableHead>
              {canEdit && <TableHead className="text-right">Thao tác</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {discounts.length === 0 ? (
              <TableRow>
                <TableCell colSpan={canEdit ? 6 : 5} className="py-8 text-center text-muted-foreground">
                  Chưa có ưu đãi nào
                </TableCell>
              </TableRow>
            ) : (
              discounts.map((d) => (
                <TableRow key={d.id} className="hover:bg-muted/60">
                  <TableCell>
                    <Badge variant="outline">{TYPE_LABEL[d.type]}</Badge>
                  </TableCell>
                  <TableCell className="font-medium tabular-nums">{formatValue(d)}</TableCell>
                  <TableCell className="max-w-[16rem] text-sm text-muted-foreground">
                    {d.note || "—"}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {formatDate(d.validFrom)} → {formatDate(d.validTo)}
                  </TableCell>
                  <TableCell>
                    {d.active ? (
                      <Badge className="bg-state-success-soft text-state-success-ink hover:bg-state-success-soft-hover">
                        Đang áp dụng
                      </Badge>
                    ) : (
                      <Badge className="bg-muted text-foreground hover:bg-muted">Tắt</Badge>
                    )}
                  </TableCell>
                  {canEdit && (
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => openEdit(d)}
                          disabled={isPending}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                          Sửa
                        </Button>
                        <Button
                          variant={confirmDeleteId === d.id ? "destructive" : "outline"}
                          size="sm"
                          onClick={() => onDelete(d.id)}
                          disabled={isPending}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                          {confirmDeleteId === d.id ? "Xác nhận xoá?" : "Xoá"}
                        </Button>
                      </div>
                    </TableCell>
                  )}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </PhanTrangBang>
    </div>
  );
}
