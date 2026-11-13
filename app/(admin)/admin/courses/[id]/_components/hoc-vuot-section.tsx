"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { luuTranHocVuotKhoaAction } from "../_actions";

// Trần học vượt của khoá [28/10/2026]: Sale chỉ xếp được bé vào lớp đã học trước tối đa bấy nhiêu buổi so với buổi bắt đầu của bé; hơn nữa chỉ Quản lý cơ sở / Quản trị tối cao.
export function HocVuotSection({ courseId, tran, canEdit }: { courseId: string; tran: number | null; canEdit: boolean }) {
  const router = useRouter();
  const [giaTri, setGiaTri] = useState(tran === null ? "" : String(tran));
  const [pending, start] = useTransition();

  const so = giaTri.trim() === "" ? null : Number(giaTri);
  const hopLe = so === null || (Number.isInteger(so) && so >= 0 && so <= 48);

  function luu() {
    if (!hopLe) return void toast.error("Trần phải là số nguyên từ 0 đến 48");
    start(async () => {
      const kq = await luuTranHocVuotKhoaAction(courseId, { tran: so });
      if (!kq.ok) {
        toast.error(kq.error ?? "Không lưu được");
        return;
      }
      toast.success(so === null ? "Đã bỏ mức riêng — khoá dùng mức chung của cơ sở" : `Đã đặt trần học vượt ${so} buổi cho khoá`);
      router.refresh();
    });
  }

  return (
    <div className="space-y-3 rounded-xl border border-border bg-card p-4 shadow-sm">
      <div className="min-w-0">
        <h2 className="text-lg font-semibold text-foreground">Học vượt</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Số buổi lớp đã học trước tối đa để Sale tự xếp bé vào lớp của khoá này (tính từ buổi bắt đầu của bé). Lớp đã học nhiều hơn thì chỉ Quản lý cơ sở hoặc Quản trị tối cao xếp được.
        </p>
      </div>

      <label className="flex flex-wrap items-center gap-3 text-sm">
        <span className="font-medium">Trần của khoá</span>
        <Input
          type="number"
          inputMode="numeric"
          min={0}
          max={48}
          className="h-9 w-24"
          placeholder="Chung"
          value={giaTri}
          disabled={!canEdit || pending}
          aria-invalid={!hopLe}
          onChange={(e) => setGiaTri(e.target.value)}
        />
        <span className="text-muted-foreground">buổi</span>
      </label>
      <p className="text-xs text-muted-foreground">
        Để trống = dùng mức chung của từng cơ sở (Cấu hình vận hành, tab Học viên; mặc định 6). Đã đặt số thì mức của khoá thắng mức cơ sở cho mọi cơ sở.
      </p>

      {canEdit ? (
        <div className="flex justify-end">
          <Button size="sm" onClick={luu} disabled={pending || !hopLe}>
            {pending ? "Đang lưu…" : "Lưu trần học vượt"}
          </Button>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">Bạn chỉ có quyền xem cấu hình này.</p>
      )}
    </div>
  );
}
