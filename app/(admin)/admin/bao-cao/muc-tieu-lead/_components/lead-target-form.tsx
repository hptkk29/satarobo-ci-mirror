"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { HelpHint } from "@/components/admin/ui/help-hint";
import { LEAD_TARGET_COUNT_MAX } from "@/lib/reports/lead-target";
import { setLeadTargetAction } from "../_actions";

type CenterOption = { id: string; name: string };

export function LeadTargetForm({
  centers,
  canSetGlobal,
  defaultCenterId,
  defaultPeriod,
}: {
  centers: CenterOption[];
  /** Cấp hội sở/quản trị mới đặt được chỉ tiêu toàn hệ thống. */
  canSetGlobal: boolean;
  /** "ALL" = toàn hệ thống, hoặc centerId. */
  defaultCenterId: string;
  defaultPeriod: string;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const formData = new FormData(e.currentTarget);
    startTransition(async () => {
      const res = await setLeadTargetAction(formData);
      if (res.ok) {
        toast.success("Đã lưu chỉ tiêu lead");
      } else {
        setError(res.error ?? "Có lỗi xảy ra");
        toast.error(res.error ?? "Có lỗi xảy ra");
      }
    });
  }

  const selectClass =
    "flex h-9 w-full rounded-md border border-border bg-card px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-border";

  return (
    <form onSubmit={onSubmit} className="grid grid-cols-1 gap-3 md:grid-cols-5 md:items-end">
      <div className="space-y-1">
        <Label htmlFor="lt-center">
          Cơ sở
          <HelpHint>
            Chỉ tiêu này áp cho cơ sở nào. &ldquo;Toàn hệ thống&rdquo; là chỉ tiêu chung
            của cả công ty và chỉ cấp hội sở đặt được — chỉ tiêu của từng cơ sở vẫn đặt
            riêng, không tự chia từ số chung và không cộng dồn với nó.
          </HelpHint>
        </Label>
        <select
          id="lt-center"
          name="centerId"
          defaultValue={defaultCenterId}
          className={selectClass}
        >
          {canSetGlobal ? <option value="ALL">Toàn hệ thống</option> : null}
          {centers.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>

      <div className="space-y-1">
        <Label htmlFor="lt-period">
          Kỳ (YYYY-MM)
          <HelpHint>
            Chỉ tiêu tính theo THÁNG. Mỗi cơ sở chỉ có một chỉ tiêu cho mỗi tháng — lưu
            lại cho tháng đã có sẽ thay số cũ, không cộng thêm.
          </HelpHint>
        </Label>
        <Input id="lt-period" name="period" type="month" defaultValue={defaultPeriod} required />
      </div>

      <div className="space-y-1">
        <Label htmlFor="lt-count">
          Chỉ tiêu (số học sinh)
          <HelpHint>
            Đếm theo HỌC SINH, không theo phụ huynh: một phụ huynh đăng ký hai con tính
            là 2. Đây là đơn vị sinh doanh thu, và cũng là đơn vị mà tỷ lệ đạt chỉ tiêu
            ở tab Kinh doanh dùng làm tử số — đặt lệch đơn vị là mọi tỷ lệ sai theo.
          </HelpHint>
        </Label>
        <Input
          id="lt-count"
          name="targetCount"
          type="number"
          min={0}
          max={LEAD_TARGET_COUNT_MAX}
          step={1}
          inputMode="numeric"
          placeholder="0"
          required
        />
      </div>

      <div className="space-y-1">
        <Label htmlFor="lt-note">
          Ghi chú
          <HelpHint>
            Ghi lý do đặt mức này (VD: &ldquo;mùa tuyển sinh hè, tăng 30% so với tháng
            5&rdquo;) để sau này nhìn lại còn hiểu vì sao.
          </HelpHint>
        </Label>
        <Input id="lt-note" name="note" type="text" placeholder="Tùy chọn" />
      </div>

      <div>
        <Button type="submit" disabled={pending} className="w-full md:w-auto">
          {pending ? "Đang lưu…" : "Lưu chỉ tiêu"}
        </Button>
      </div>

      {error ? <p className="md:col-span-5 text-sm text-state-danger-ink">{error}</p> : null}
    </form>
  );
}
