"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MoneyInput } from "@/components/ui/money-input";
import { HelpHint } from "@/components/admin/ui/help-hint";
import { setRevenueTargetAction } from "../_actions";

type CenterOption = { id: string; name: string };

export function RevenueTargetForm({
  centers,
  canSetGlobal,
  defaultCenterId,
  defaultPeriod,
}: {
  centers: CenterOption[];
  /** HO-level/SUPER_ADMIN mới được đặt mục tiêu toàn hệ thống. */
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
      const res = await setRevenueTargetAction(formData);
      if (res.ok) {
        toast.success("Đã lưu mục tiêu doanh thu");
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
        <Label htmlFor="rt-center">
          Cơ sở
          <HelpHint>
            Mục tiêu này áp cho cơ sở nào. &ldquo;Toàn hệ thống&rdquo; là mục tiêu chung
            của cả công ty và chỉ cấp hội sở đặt được — mục tiêu của từng cơ sở vẫn đặt
            riêng, không tự chia từ số chung.
          </HelpHint>
        </Label>
        <select
          id="rt-center"
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
        <Label htmlFor="rt-period">
          Kỳ (YYYY-MM)
          <HelpHint>
            Mục tiêu tính theo THÁNG. Mỗi cơ sở chỉ có một mục tiêu cho mỗi tháng — lưu
            lại cho tháng đã có sẽ thay số cũ, không cộng thêm.
          </HelpHint>
        </Label>
        <Input id="rt-period" name="period" type="month" defaultValue={defaultPeriod} required />
      </div>

      <div className="space-y-1">
        <Label htmlFor="rt-amount">
          Mục tiêu (VNĐ)
          <HelpHint>
            Doanh thu cần đạt trong tháng đã chọn. Con số này hiện trên trang báo cáo
            doanh thu để so với số thu thực tế — ai xem được báo cáo của cơ sở nào thì
            thấy mục tiêu của cơ sở đó.
          </HelpHint>
        </Label>
        {/* Ô tiền: gõ 10000000 → hiện 10.000.000. Số trần vẫn đi lên qua FormData nhờ ô
            ẩn cùng `name` — setRevenueTargetAction không phải sửa gì. */}
        <MoneyInput
          id="rt-amount"
          name="targetAmount"
          min={0}
          placeholder="0"
          required
        />
      </div>

      <div className="space-y-1">
        <Label htmlFor="rt-note">
          Ghi chú
          <HelpHint>
            Ghi lý do đặt mức này (VD: &ldquo;mùa hè, tăng 20% so với tháng 5&rdquo;) để
            sau này nhìn lại còn hiểu vì sao. Chỉ người xem báo cáo đọc được.
          </HelpHint>
        </Label>
        <Input id="rt-note" name="note" type="text" placeholder="Tùy chọn" />
      </div>

      <div>
        <Button type="submit" disabled={pending} className="w-full md:w-auto">
          {pending ? "Đang lưu…" : "Lưu mục tiêu"}
        </Button>
      </div>

      {error ? (
        <p className="md:col-span-5 text-sm text-state-danger-ink">{error}</p>
      ) : null}
    </form>
  );
}
