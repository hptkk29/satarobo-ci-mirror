"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useFormStatus } from "react-dom";
import { toast } from "sonner";
import { createClassGroup, updateClassGroup } from "../_actions";

type OrgUnitOption = { id: string; name: string; code: string | null };

export type ClassGroupFormValue = {
  id?: string;
  displayCode: string;
  name: string | null;
  orgUnitId: string | null;
  status: string;
  notes: string | null;
};

const STATUS_OPTIONS = [
  { value: "ACTIVE", label: "Đang hoạt động" },
  { value: "GRADUATED", label: "Đã tốt nghiệp" },
  { value: "DISBANDED", label: "Đã giải thể" },
];

export function ClassGroupForm({
  group,
  orgUnits,
}: {
  group?: ClassGroupFormValue;
  orgUnits: OrgUnitOption[];
}) {
  const router = useRouter();
  const isEdit = Boolean(group);
  const [error, setError] = useState<string | null>(null);

  async function action(formData: FormData) {
    setError(null);
    const res = group
      ? await updateClassGroup(group.id!, formData)
      : await createClassGroup(formData);
    if (res?.error) {
      setError(res.error);
      return;
    }
    // QA 20/07 — toast thành công thay vì redirect âm thầm.
    toast.success(isEdit ? "Đã cập nhật nhóm lớp" : "Đã tạo nhóm lớp mới");
    router.push("/class-groups");
  }

  return (
    <form action={action} className="max-w-2xl space-y-5">
      {error && (
        <div className="rounded-lg border border-state-danger-soft bg-state-danger-soft px-4 py-3 text-sm text-state-danger-ink">
          {error}
        </div>
      )}

      <div>
        <label className="mb-1 block text-sm font-semibold text-foreground">
          Mã hiển thị * <span className="font-normal text-muted-foreground">(vd A1, B2)</span>
        </label>
        <input
          name="displayCode"
          defaultValue={group?.displayCode ?? ""}
          required
          maxLength={20}
          placeholder="A1"
          className="w-full rounded-lg border border-border px-3 py-2 text-sm focus:border-state-info focus:outline-none focus:ring-2 focus:ring-state-info-soft"
        />
        <p className="mt-1 text-xs text-muted-foreground">
          Mã định danh đầy đủ (CS1.LOP.26.xxx) sẽ tự sinh khi tạo.
        </p>
      </div>

      <div>
        <label className="mb-1 block text-sm font-semibold text-foreground">
          Tên nhóm <span className="font-normal text-muted-foreground">(tuỳ chọn)</span>
        </label>
        <input
          name="name"
          defaultValue={group?.name ?? ""}
          placeholder="VD: Nhóm Sao Mai khai giảng 2026"
          className="w-full rounded-lg border border-border px-3 py-2 text-sm focus:border-state-info focus:outline-none focus:ring-2 focus:ring-state-info-soft"
        />
      </div>

      <div>
        <label className="mb-1 block text-sm font-semibold text-foreground">
          Đơn vị *
        </label>
        <select
          name="orgUnitId"
          defaultValue={group?.orgUnitId ?? ""}
          required
          className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm focus:border-state-info focus:outline-none focus:ring-2 focus:ring-state-info-soft"
        >
          <option value="">-- Chọn đơn vị --</option>
          {orgUnits.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name} {o.code ? `(${o.code})` : ""}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="mb-1 block text-sm font-semibold text-foreground">
          Trạng thái
        </label>
        <select
          name="status"
          defaultValue={group?.status ?? "ACTIVE"}
          className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm focus:border-state-info focus:outline-none focus:ring-2 focus:ring-state-info-soft"
        >
          {STATUS_OPTIONS.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="mb-1 block text-sm font-semibold text-foreground">
          Ghi chú
        </label>
        <textarea
          name="notes"
          defaultValue={group?.notes ?? ""}
          rows={3}
          className="w-full rounded-lg border border-border px-3 py-2 text-sm focus:border-state-info focus:outline-none focus:ring-2 focus:ring-state-info-soft"
        />
      </div>

      <div className="flex gap-3 border-t border-border pt-5">
        <SubmitButton isEdit={isEdit} />
        <button
          type="button"
          onClick={() => router.push("/class-groups")}
          className="rounded-lg border border-border bg-card px-5 py-2.5 text-sm font-semibold text-foreground hover:bg-muted"
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
      className="rounded-lg bg-primary px-6 py-2.5 text-sm font-bold text-primary-foreground hover:bg-primary-dark disabled:opacity-60"
    >
      {pending ? "Đang lưu..." : isEdit ? "Cập nhật" : "Tạo nhóm lớp"}
    </button>
  );
}
