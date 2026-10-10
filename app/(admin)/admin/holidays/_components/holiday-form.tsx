"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useFormStatus } from "react-dom";
import { toast } from "sonner";
import { createHoliday, updateHoliday } from "../_actions";
import { TYPE_LABELS, toDateInput } from "./helpers";

export type HolidayFormValue = {
  id: string;
  name: string;
  date: Date;
  endDate: Date | null;
  orgUnitId: string | null; // PR-C: đơn vị (OrgUnit) — nguồn chính; centerId suy ra ở action
  type: "HOLIDAY" | "MAINTENANCE" | "EVENT" | "OTHER";
  note: string | null;
  // Module chấm công v3 (L3, T-04)
  attendanceEffect?: "PAID_LEAVE" | "UNPAID_OFF" | "INFO_ONLY" | null;
  coefficient?: number;
  briefMode?: "APPEND" | "SUPPRESS" | "REPLACE" | null;
  briefText?: string | null;
};

export type OrgUnitOption = {
  id: string;
  name: string;
};

export function HolidayForm({
  holiday,
  orgUnits,
}: {
  holiday?: HolidayFormValue;
  orgUnits: OrgUnitOption[];
}) {
  const router = useRouter();
  const isEdit = Boolean(holiday);
  const [error, setError] = useState<string | null>(null);
  const [date, setDate] = useState<string>(toDateInput(holiday?.date) || "");
  const [endDate, setEndDate] = useState<string>(toDateInput(holiday?.endDate));

  async function action(formData: FormData) {
    setError(null);
    if (endDate && date && endDate < date) {
      setError("Ngày kết thúc phải >= ngày bắt đầu");
      return;
    }
    formData.set("date", date);
    formData.set("endDate", endDate);
    const res = isEdit
      ? await updateHoliday(holiday!.id, formData)
      : await createHoliday(formData);
    if (res?.error) {
      setError(res.error);
      return;
    }
    // QA 20/07 — toast thành công thay vì redirect âm thầm.
    // 27/09/2026 — nói rõ việc hệ thống vừa làm với lịch lớp, kể cả khi KHÔNG dời gì.
    const d = res?.daDoi;
    toast.success(isEdit ? "Đã cập nhật ngày nghỉ" : "Đã tạo ngày nghỉ mới", {
      description:
        d && d.shifted > 0
          ? `Đã dời ${d.shifted} buổi của ${d.affectedClasses} lớp lùi một nhịp (giữ đúng thứ tự bài).`
          : "Không có buổi học nào trùng ngày nghỉ — lịch lớp giữ nguyên.",
    });
    router.push("/holidays");
  }

  return (
    <form action={action} className="max-w-3xl space-y-6">
      {error && (
        <div className="rounded-lg border border-state-danger-soft bg-state-danger-soft px-4 py-3 text-sm text-state-danger-ink">
          {error}
        </div>
      )}

      <Section title="Thông tin ngày nghỉ">
        <Field
          label="Tên ngày nghỉ"
          name="name"
          defaultValue={holiday?.name}
          placeholder="VD: Tết Nguyên Đán 2026"
          required
        />
        <Grid cols={2}>
          <DateInput
            label="Ngày bắt đầu"
            value={date}
            onChange={setDate}
            required
          />
          <DateInput
            label="Ngày kết thúc"
            value={endDate}
            onChange={setEndDate}
            helper="Để trống nếu nghỉ 1 ngày"
            min={date || undefined}
          />
        </Grid>
        <Grid cols={2}>
          <SelectField
            label="Phạm vi"
            name="orgUnitId"
            defaultValue={holiday?.orgUnitId ?? "ALL"}
            options={[
              { value: "ALL", label: "Toàn hệ thống" },
              ...orgUnits.map((o) => ({ value: o.id, label: o.name })),
            ]}
            required
          />
          <SelectField
            label="Loại"
            name="type"
            defaultValue={holiday?.type ?? "HOLIDAY"}
            options={(Object.keys(TYPE_LABELS) as (keyof typeof TYPE_LABELS)[]).map(
              (v) => ({
                value: v,
                label: TYPE_LABELS[v],
              }),
            )}
            required
          />
        </Grid>
      </Section>

      <Section title="Chấm công (T-04 — Kế toán tự đặt)">
        <Grid cols={2}>
          <SelectField
            label="Ảnh hưởng tới công"
            name="attendanceEffect"
            defaultValue={holiday?.attendanceEffect ?? ""}
            options={[
              { value: "", label: "Mặc định (lễ = nghỉ hưởng công)" },
              { value: "PAID_LEAVE", label: "Nghỉ hưởng công (cột lễ riêng × hệ số)" },
              { value: "UNPAID_OFF", label: "Nghỉ không tính công" },
              { value: "INFO_ONLY", label: "Chỉ thông tin — vẫn tính như ngày thường" },
            ]}
          />
          <Field
            label="Hệ số công ngày lễ (0–5)"
            name="coefficient"
            type="text"
            defaultValue={String(holiday?.coefficient ?? 1)}
            placeholder="1"
          />
        </Grid>
        <Grid cols={2}>
          <SelectField
            label="Tin nhắc 19:00"
            name="briefMode"
            defaultValue={holiday?.briefMode ?? ""}
            options={[
              { value: "", label: "Gửi bình thường" },
              { value: "SUPPRESS", label: "Không gửi tin" },
              { value: "REPLACE", label: "Thay toàn bộ bằng nội dung dưới" },
              { value: "APPEND", label: "Gửi kèm nội dung dưới" },
            ]}
          />
          <Field
            label="Nội dung tin (nếu có)"
            name="briefText"
            type="text"
            defaultValue={holiday?.briefText ?? undefined}
            placeholder="VD: NGHỈ LỄ — Quốc khánh 02/9"
          />
        </Grid>
      </Section>

      <Section title="Ghi chú">
        <Field
          label="Ghi chú"
          name="note"
          type="textarea"
          rows={3}
          defaultValue={holiday?.note ?? undefined}
          placeholder="Ghi chú nội bộ (không hiển thị public)"
        />
      </Section>

      <div className="flex gap-3 border-t border-border pt-6">
        <SubmitButton isEdit={isEdit} />
        <button
          type="button"
          onClick={() => router.push("/holidays")}
          className="rounded-xl border-2 border-border bg-card px-6 py-3 font-bold text-foreground hover:bg-muted"
        >
          Huỷ
        </button>
      </div>
    </form>
  );
}

function SubmitButton({ isEdit }: { isEdit: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-xl bg-primary px-6 py-3 font-bold text-white shadow-md hover:bg-primary-dark disabled:opacity-60"
    >
      {pending ? "Đang lưu..." : isEdit ? "Cập nhật" : "Tạo ngày nghỉ"}
    </button>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-border bg-card p-6">
      <h2 className="mb-4 text-sm font-bold uppercase tracking-wider text-foreground">
        {title}
      </h2>
      <div className="space-y-4">{children}</div>
    </section>
  );
}

function Grid({ children, cols = 2 }: { children: React.ReactNode; cols?: 2 | 3 }) {
  const grid = cols === 3 ? "md:grid-cols-3" : "md:grid-cols-2";
  return <div className={`grid grid-cols-1 ${grid} gap-4`}>{children}</div>;
}

const baseInput =
  "w-full rounded-lg border border-border bg-card px-3 py-2 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20";

function Field({
  label,
  name,
  type = "text",
  rows = 3,
  defaultValue,
  placeholder,
  required,
  helper,
}: {
  label: string;
  name: string;
  type?: "text" | "textarea";
  rows?: number;
  defaultValue?: string | null;
  placeholder?: string;
  required?: boolean;
  helper?: string;
}) {
  const value = defaultValue ?? "";
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-semibold text-foreground">
        {label}
        {required && <span className="ml-1 text-state-danger-ink">*</span>}
      </span>
      {type === "textarea" ? (
        <textarea
          name={name}
          rows={rows}
          defaultValue={value}
          placeholder={placeholder}
          required={required}
          className={baseInput + " resize-y"}
        />
      ) : (
        <input
          type="text"
          name={name}
          defaultValue={value}
          placeholder={placeholder}
          required={required}
          className={baseInput}
        />
      )}
      {helper && <span className="mt-1 block text-xs text-muted-foreground">{helper}</span>}
    </label>
  );
}

function DateInput({
  label,
  value,
  onChange,
  required,
  helper,
  min,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  required?: boolean;
  helper?: string;
  min?: string;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-semibold text-foreground">
        {label}
        {required && <span className="ml-1 text-state-danger-ink">*</span>}
      </span>
      <input
        type="date"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        min={min}
        required={required}
        className={baseInput}
      />
      {helper && <span className="mt-1 block text-xs text-muted-foreground">{helper}</span>}
    </label>
  );
}

function SelectField({
  label,
  name,
  options,
  defaultValue,
  required,
}: {
  label: string;
  name: string;
  options: { value: string; label: string }[];
  defaultValue?: string | null;
  required?: boolean;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-semibold text-foreground">
        {label}
        {required && <span className="ml-1 text-state-danger-ink">*</span>}
      </span>
      <select
        name={name}
        defaultValue={defaultValue ?? ""}
        required={required}
        className={baseInput}
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </label>
  );
}
