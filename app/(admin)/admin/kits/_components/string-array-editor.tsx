"use client";

import { Plus, X, GripVertical } from "lucide-react";

interface StringArrayEditorProps {
  value: string[];
  onChange: (next: string[]) => void;
  /** Hidden input name for form submission (encoded as JSON string) */
  name?: string;
  placeholder?: string;
}

export function StringArrayEditor({
  value,
  onChange,
  name,
  placeholder = "Nội dung mục...",
}: StringArrayEditorProps) {
  const add = () => onChange([...value, ""]);
  const remove = (idx: number) => onChange(value.filter((_, i) => i !== idx));
  const update = (idx: number, next: string) =>
    onChange(value.map((item, i) => (i === idx ? next : item)));

  return (
    <div className="space-y-2">
      {value.length === 0 ? (
        <p className="text-sm italic text-muted-foreground">Chưa có mục. Bấm "Thêm mục" để bắt đầu.</p>
      ) : (
        value.map((item, idx) => (
          <div
            key={idx}
            className="flex items-start gap-2 rounded-lg border border-border bg-muted p-2"
          >
            <span className="mt-2 text-muted-foreground">
              <GripVertical className="h-4 w-4" />
            </span>
            <textarea
              value={item}
              onChange={(e) => update(idx, e.target.value)}
              placeholder={placeholder}
              rows={2}
              className="flex-1 resize-y rounded-lg border border-border bg-card px-3 py-2 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
            />
            <button
              type="button"
              onClick={() => remove(idx)}
              className="rounded-lg p-2 text-state-danger-ink hover:bg-state-danger-soft"
              aria-label="Xoá mục"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        ))
      )}

      <button
        type="button"
        onClick={add}
        className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-sm font-semibold text-primary hover:bg-primary-soft"
      >
        <Plus className="h-4 w-4" />
        Thêm mục
      </button>

      {name && <input type="hidden" name={name} value={JSON.stringify(value)} />}
    </div>
  );
}
