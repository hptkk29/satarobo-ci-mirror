"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { WEEKDAY_LABELS_VN } from "@/lib/working-hours/rules";
import {
  WEEKDAY_DISPLAY_ORDER,
  applyHoursToOtherDays,
  daysToPayload,
  type WorkingHourDayForm,
} from "@/lib/working-hours/form";
import { saveWorkingHoursAction } from "../_actions";

export type RoleChoice = { code: string; name: string };

type Props = {
  centerId: string;
  centerName: string;
  /** Vai đang khai; "*" = luật áp cho mọi vai. */
  roleCode: string;
  roleChoices: readonly RoleChoice[];
  initialDays: readonly WorkingHourDayForm[];
  /** `centers:edit` — thiếu thì màn chỉ để XEM (không ẩn, để người dùng biết giờ đang là gì). */
  canEdit: boolean;
};

/** Mọi vai trò = sentinel "*" của `WorkingHourRule.roleCode`. */
const ALL_ROLES = "*";

export function WorkingHoursEditor({
  centerId,
  centerName,
  roleCode,
  roleChoices,
  initialDays,
  canEdit,
}: Props) {
  const router = useRouter();
  const [days, setDays] = useState<WorkingHourDayForm[]>(() => [...initialDays]);
  const [pending, startTransition] = useTransition();

  // So bằng chuỗi JSON: 7 mục phẳng, rẻ hơn nhiều so với việc bắt người đọc code tự nhớ
  // phải cập nhật hàm so sánh tay mỗi lần thêm một trường vào dòng.
  const dirty = useMemo(
    () => JSON.stringify(days) !== JSON.stringify(initialDays),
    [days, initialDays],
  );

  const patchDay = (weekday: number, patch: Partial<WorkingHourDayForm>) => {
    setDays((prev) =>
      prev.map((d) =>
        d.weekday === weekday
          ? // Chạm tay vào một ngày = ngày đó không còn kế thừa nữa. Không suy diễn
            // "giá trị trùng bậc trên thì vẫn coi là kế thừa": người dùng có quyền cố ý
            // khai trùng để khoá giá trị lại, không cho bậc trên đổi kéo theo.
            { ...d, ...patch, declared: true }
          : d,
      ),
    );
  };

  /** Trả một ngày về kế thừa — giá trị hiển thị lấy lại từ trạng thái ban đầu của server. */
  const resetDay = (weekday: number) => {
    const original = initialDays.find((d) => d.weekday === weekday);
    setDays((prev) =>
      prev.map((d) =>
        d.weekday !== weekday
          ? d
          : original && !original.declared
            ? { ...original }
            : // Ngày này VỐN đã khai riêng từ trước ⇒ chưa có sẵn giá trị kế thừa để
              // hiện. Bỏ cờ declared là đủ để lần lưu tới xoá dòng; con số trên màn hình
              // chỉ còn là tham khảo cho tới khi tải lại trang.
              { ...d, declared: false },
      ),
    );
  };

  const changeRole = (next: string) => {
    // Đổi vai = server phải tính lại toàn bộ bậc kế thừa ⇒ đi qua URL, không tự đoán
    // ở client. Chặn khi đang có thay đổi chưa lưu để không nuốt mất công người dùng.
    router.replace(
      next === ALL_ROLES
        ? `/centers/${centerId}/gio-lam-viec`
        : `/centers/${centerId}/gio-lam-viec?vai=${encodeURIComponent(next)}`,
    );
  };

  const save = () => {
    startTransition(async () => {
      const res = await saveWorkingHoursAction({
        centerId,
        roleCode,
        days: daysToPayload(days),
      });
      if (res.ok) {
        toast.success("Đã lưu giờ làm việc");
        router.refresh();
      } else {
        toast.error(res.error);
      }
    });
  };

  const declaredCount = days.filter((d) => d.declared).length;

  return (
    <div className="space-y-4">
      <section className="rounded-xl border border-border bg-card p-4">
        <h2 className="text-sm font-bold uppercase tracking-wider text-foreground">
          Áp dụng cho vai trò
        </h2>
        <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
          <select
            value={roleCode}
            onChange={(e) => changeRole(e.target.value)}
            disabled={dirty || pending}
            aria-label="Vai trò áp dụng giờ làm việc"
            className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 disabled:opacity-60 sm:w-72"
          >
            <option value={ALL_ROLES}>Mọi vai trò (mặc định của cơ sở)</option>
            {roleChoices.map((r) => (
              <option key={r.code} value={r.code}>
                {r.name} ({r.code})
              </option>
            ))}
          </select>
          <p className="text-xs text-muted-foreground">
            {roleCode === ALL_ROLES
              ? "Giờ khai ở đây áp cho tất cả nhân sự của cơ sở, trừ vai nào được khai riêng."
              : "Giờ khai ở đây CHỈ áp cho vai này; các vai khác vẫn theo “Mọi vai trò”."}
          </p>
        </div>
        {dirty && (
          <p className="mt-2 text-xs font-semibold text-state-warning-ink">
            Đang có thay đổi chưa lưu — lưu xong mới đổi được vai.
          </p>
        )}
      </section>

      <section className="rounded-xl border border-border bg-card p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-sm font-bold uppercase tracking-wider text-foreground">
            Giờ làm việc theo thứ
          </h2>
          <p className="text-xs text-muted-foreground">
            {declaredCount === 0
              ? "Chưa khai riêng thứ nào — cả tuần đang kế thừa bậc trên."
              : `Đang khai riêng ${declaredCount}/7 thứ cho ${centerName}.`}
          </p>
        </div>

        <p className="mt-2 rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
          <span className="font-semibold text-foreground">Kế thừa</span> = chưa khai riêng,
          giá trị chạy theo cấu hình toàn hệ thống và tự đổi khi cấu hình đó đổi.{" "}
          <span className="font-semibold text-foreground">Khai riêng</span> = cố định cho cơ
          sở này, kể cả khi giá trị đang trùng với bậc trên.
        </p>

        <div className="mt-3 space-y-3">
          {WEEKDAY_DISPLAY_ORDER.map((weekday) => {
            const day = days.find((d) => d.weekday === weekday);
            if (!day) return null;
            return (
              <DayRow
                key={weekday}
                day={day}
                canEdit={canEdit}
                pending={pending}
                onPatch={(patch) => patchDay(weekday, patch)}
                onReset={() => resetDay(weekday)}
                onApplyToOthers={() =>
                  setDays((prev) => applyHoursToOtherDays(prev, weekday))
                }
              />
            );
          })}
        </div>
      </section>

      {canEdit && (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <Button onClick={save} disabled={pending || !dirty}>
            {pending ? "Đang lưu…" : "Lưu giờ làm việc"}
          </Button>
          <Button
            variant="outline"
            onClick={() => setDays([...initialDays])}
            disabled={pending || !dirty}
          >
            Huỷ thay đổi
          </Button>
          <Button
            variant="ghost"
            onClick={() => setDays((prev) => prev.map((d) => ({ ...d, declared: false })))}
            disabled={pending || declaredCount === 0}
            title="Xoá mọi khai riêng của cơ sở này, quay về giá trị kế thừa"
          >
            Đưa cả tuần về kế thừa
          </Button>
        </div>
      )}
      {!canEdit && (
        <p className="rounded-lg border border-state-warning-soft bg-state-warning-soft px-3 py-2 text-sm text-state-warning-ink">
          Bạn chỉ có quyền xem giờ làm việc. Cần quyền “Sửa cơ sở” để chỉnh.
        </p>
      )}
    </div>
  );
}

function DayRow({
  day,
  canEdit,
  pending,
  onPatch,
  onReset,
  onApplyToOthers,
}: {
  day: WorkingHourDayForm;
  canEdit: boolean;
  pending: boolean;
  onPatch: (patch: Partial<WorkingHourDayForm>) => void;
  onReset: () => void;
  onApplyToOthers: () => void;
}) {
  const disabled = !canEdit || pending;
  return (
    <div className="rounded-lg border border-border p-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="w-24 shrink-0 text-sm font-bold text-foreground">
          {WEEKDAY_LABELS_VN[day.weekday]}
        </span>
        {day.declared ? (
          <span className="rounded-full bg-state-info-soft px-2 py-0.5 text-[11px] font-semibold text-state-info-ink">
            Khai riêng
          </span>
        ) : (
          <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold text-muted-foreground">
            Kế thừa
          </span>
        )}
        <label className="ml-auto inline-flex items-center gap-2">
          <Switch
            checked={day.isClosed}
            onCheckedChange={(v) =>
              // Bật nghỉ thì XOÁ luôn hai ô giờ: để lại giờ cũ là dữ liệu tự mâu thuẫn,
              // và Zod ở server sẽ từ chối đúng vì lý do đó.
              onPatch(v ? { isClosed: true, openTime: "", closeTime: "" } : { isClosed: false })
            }
            disabled={disabled}
            aria-label={`Nghỉ cả ngày ${WEEKDAY_LABELS_VN[day.weekday]}`}
          />
          <span className="text-sm text-foreground">Nghỉ cả ngày</span>
        </label>
      </div>

      {!day.isClosed && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Input
            type="time"
            value={day.openTime}
            onChange={(e) => onPatch({ openTime: e.target.value })}
            disabled={disabled}
            aria-label={`Giờ mở cửa ${WEEKDAY_LABELS_VN[day.weekday]}`}
            className="w-32"
          />
          <span className="text-sm text-muted-foreground">→</span>
          <Input
            type="time"
            value={day.closeTime}
            onChange={(e) => onPatch({ closeTime: e.target.value })}
            disabled={disabled}
            aria-label={`Giờ đóng cửa ${WEEKDAY_LABELS_VN[day.weekday]}`}
            className="w-32"
          />
          {canEdit && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onApplyToOthers}
              disabled={disabled}
              title="Chép giờ mở/đóng của thứ này sang các thứ còn lại (không đụng ngày đang nghỉ)"
            >
              Áp dụng cho các ngày còn lại
            </Button>
          )}
        </div>
      )}

      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <span>
          Bậc trên đang là: <span className="font-semibold">{day.inheritedLabel}</span>
        </span>
        {canEdit && day.declared && (
          <button
            type="button"
            onClick={onReset}
            disabled={disabled}
            className="font-semibold text-primary underline-offset-2 hover:underline disabled:opacity-60"
          >
            Bỏ khai riêng, dùng lại giá trị kế thừa
          </button>
        )}
      </div>
    </div>
  );
}
