"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useFormStatus } from "react-dom";
import { StringArrayEditor } from "@/app/(admin)/admin/kits/_components/string-array-editor";
import { FieldLabel, HelpHint } from "@/components/admin/ui/help-hint";
import { createRoom, updateRoom } from "../_actions";

export type RoomFormValue = {
  id: string;
  name: string;
  code: string;
  orgUnitId: string | null; // PR-C: đơn vị (OrgUnit) — nguồn chính; centerId suy ra ở action
  capacity: number;
  equipment: string[];
  status: "ACTIVE" | "MAINTENANCE" | "INACTIVE";
  notes: string | null;
  displayOrder: number;
};

export type OrgUnitOption = {
  id: string;
  name: string;
};

export function RoomForm({
  room,
  orgUnits,
  quayVe,
  donViMacDinh,
}: {
  room?: RoomFormValue;
  orgUnits: OrgUnitOption[];
  /** Mở từ trang cơ sở ⇒ lưu/huỷ xong quay lại đó (server kiểm dạng đường). */
  quayVe?: string;
  /** Tạo phòng từ trang cơ sở ⇒ chọn sẵn đơn vị của cơ sở đó. */
  donViMacDinh?: string;
}) {
  const router = useRouter();
  const isEdit = Boolean(room);
  const [error, setError] = useState<string | null>(null);
  const [equipment, setEquipment] = useState<string[]>(room?.equipment ?? []);

  async function action(formData: FormData) {
    setError(null);
    formData.set("equipment", JSON.stringify(equipment));
    const res = isEdit
      ? await updateRoom(room!.id, formData)
      : await createRoom(formData);
    if (res?.error) setError(res.error);
  }

  return (
    <form action={action} className="max-w-3xl space-y-6">
      {error && (
        <div className="rounded-lg border border-state-danger-soft bg-state-danger-soft px-4 py-3 text-sm text-state-danger-ink">
          {error}
        </div>
      )}

      <Section title="Thông tin phòng">
        <Grid cols={2}>
          <Field label="Tên phòng" name="name" defaultValue={room?.name} required />
          <Field
            label="Mã phòng"
            name="code"
            defaultValue={room?.code}
            placeholder="DN-A1"
            required
            helper="Chỉ A-Z, 0-9, dấu -. Unique trong cơ sở."
          />
        </Grid>
        <Grid cols={2}>
          <SelectField
            label="Cơ sở"
            name="orgUnitId"
            defaultValue={room?.orgUnitId ?? donViMacDinh}
            required
            options={orgUnits.map((o) => ({ value: o.id, label: o.name }))}
          />
          <Field
            label="Sức chứa"
            name="capacity"
            type="number"
            min={1}
            defaultValue={room?.capacity ?? 15}
            required
          />
        </Grid>
        <Grid cols={2}>
          <SelectField
            label="Trạng thái"
            name="status"
            defaultValue={room?.status ?? "ACTIVE"}
            required
            options={[
              { value: "ACTIVE", label: "Hoạt động" },
              { value: "MAINTENANCE", label: "Bảo trì" },
              { value: "INACTIVE", label: "Tạm ngừng" },
            ]}
          />
          <Field
            label="Thứ tự hiển thị"
            name="displayOrder"
            type="number"
            defaultValue={room?.displayOrder ?? 0}
          />
        </Grid>
      </Section>

      <Section
        title="Thiết bị"
        hint={
          <>
            Mỗi mục là 1 thiết bị. VD: <em>Robot SR1</em>, <em>Laptop</em>,{" "}
            <em>Máy chiếu</em>.
          </>
        }
      >
        <StringArrayEditor
          value={equipment}
          onChange={setEquipment}
          placeholder="VD: Robot SR1"
        />
      </Section>

      <Section title="Ghi chú nội bộ">
        <Field
          label="Ghi chú"
          name="notes"
          type="textarea"
          rows={3}
          defaultValue={room?.notes ?? undefined}
          placeholder="Ghi chú riêng cho admin / vận hành (không hiển thị public)"
        />
      </Section>

      {quayVe && <input type="hidden" name="quayVe" value={quayVe} />}
      <div className="flex gap-3 border-t border-border pt-6">
        <SubmitButton isEdit={isEdit} />
        <button
          type="button"
          onClick={() => router.push(quayVe ?? "/rooms")}
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
      {pending ? "Đang lưu..." : isEdit ? "Cập nhật" : "Tạo phòng"}
    </button>
  );
}

function Section({
  title,
  hint,
  children,
}: {
  title: string;
  /** Có nội dung → icon "?" cạnh tiêu đề khối, thay cho đoạn chữ mờ dài dưới các ô. */
  hint?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-border bg-card p-6">
      <h2 className="mb-4 text-sm font-bold uppercase tracking-wider text-foreground">
        {title}
        {/* `normal-case tracking-normal` đặt trên NỘI DUNG chứ không trên nút: tiêu đề khối
            đang uppercase + giãn chữ, hướng dẫn 2–3 câu mà kế thừa thì đọc không nổi. */}
        {hint && (
          <HelpHint className="ml-1">
            <span className="block normal-case tracking-normal">{hint}</span>
          </HelpHint>
        )}
      </h2>
      <div className="space-y-4">{children}</div>
    </section>
  );
}

function Grid({ children, cols = 2 }: { children: React.ReactNode; cols?: 2 | 3 }) {
  const grid = cols === 3 ? "md:grid-cols-3" : "md:grid-cols-2";
  return <div className={`grid grid-cols-1 ${grid} gap-4`}>{children}</div>;
}

type FieldProps = {
  label: string;
  name: string;
  type?: "text" | "number" | "textarea";
  rows?: number;
  min?: number;
  defaultValue?: string | number | null;
  placeholder?: string;
  required?: boolean;
  helper?: string;
};

function Field({
  label,
  name,
  type = "text",
  rows = 3,
  min,
  defaultValue,
  placeholder,
  required,
  helper,
}: FieldProps) {
  const value = defaultValue ?? "";
  const baseClass =
    "w-full rounded-lg border border-border bg-card px-3 py-2 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20";
  return (
    // `helper` nay ra icon "?" CẠNH NHÃN thay vì dòng chữ mờ dưới ô — sửa một chỗ, cả form
    // đổi theo. Nút "?" nằm trong <label> vẫn an toàn: <button> là interactive content nên
    // trình duyệt KHÔNG chuyển tiếp cú bấm xuống ô nhập.
    <label className="block">
      <FieldLabel label={label} required={required} hint={helper} />
      {type === "textarea" ? (
        <textarea
          name={name}
          rows={rows}
          defaultValue={value}
          placeholder={placeholder}
          required={required}
          className={baseClass + " resize-y"}
        />
      ) : (
        <input
          type={type}
          name={name}
          min={min}
          defaultValue={value}
          placeholder={placeholder}
          required={required}
          className={baseClass}
        />
      )}
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
        className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
      >
        {!required && <option value="">— Chọn —</option>}
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </label>
  );
}
