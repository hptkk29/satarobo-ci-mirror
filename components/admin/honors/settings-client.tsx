"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ImageUploader } from "@/components/admin/ImageUploader";
import { updatePageContentAction } from "@/app/(admin)/admin/honors/actions";

export type SettingField = {
  key: string;
  label: string;
  placeholder: string;
  type: "text" | "textarea" | "avatar";
};

interface Props {
  fields: SettingField[];
  initialValues: Record<string, string>;
}

export function HonorsSettingsClient({ fields, initialValues }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [values, setValues] = useState<Record<string, string>>(initialValues);

  const saveField = (key: string, value: string) => {
    startTransition(async () => {
      const res = await updatePageContentAction({
        pageKey: "honors",
        contentKey: key,
        contentValue: value,
      });
      if (res.ok) {
        toast.success("Đã lưu");
        setValues((prev) => ({ ...prev, [key]: value }));
        router.refresh();
      } else {
        toast.error(res.error || "Có lỗi");
      }
    });
  };

  return (
    <div className="space-y-4">
      {fields.map((field) => (
        <FieldEditor
          key={field.key}
          field={field}
          value={values[field.key] || ""}
          onSave={(v) => saveField(field.key, v)}
          disabled={isPending}
        />
      ))}
    </div>
  );
}

function FieldEditor({
  field,
  value,
  onSave,
  disabled,
}: {
  field: SettingField;
  value: string;
  onSave: (v: string) => void;
  disabled: boolean;
}) {
  const [draft, setDraft] = useState(value);
  const dirty = draft !== value;

  // Sync draft when underlying value changes (after save)
  if (value !== undefined && !dirty && draft !== value) {
    // No-op; this is read-time check
  }

  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <label className="mb-2 block text-sm font-semibold text-foreground">
        {field.label}
        <span className="ml-2 text-xs font-normal text-muted-foreground">({field.key})</span>
      </label>

      {field.type === "text" && (
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={field.placeholder}
          className="w-full rounded-lg border border-border px-3 py-2 text-sm focus:border-primary focus:outline-none"
        />
      )}

      {field.type === "textarea" && (
        <textarea
          rows={5}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={field.placeholder}
          className="w-full rounded-lg border border-border px-3 py-2 text-sm focus:border-primary focus:outline-none"
        />
      )}

      {field.type === "avatar" && (
        <ImageUploader
          value={draft}
          onChange={(url) => setDraft(url ?? "")}
          prefix="uploads/honors"
          aspect="square"
        />
      )}

      <div className="mt-3 flex items-center justify-end gap-2">
        {dirty && (
          <button
            type="button"
            onClick={() => setDraft(value)}
            disabled={disabled}
            className="rounded border border-border px-3 py-1.5 text-sm text-foreground hover:bg-muted"
          >
            Reset
          </button>
        )}
        <button
          type="button"
          onClick={() => onSave(draft)}
          disabled={disabled || !dirty}
          className="rounded bg-primary px-4 py-1.5 text-sm font-bold text-white hover:opacity-90 disabled:opacity-40"
        >
          Lưu
        </button>
      </div>
    </div>
  );
}
