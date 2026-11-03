"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus, Trash2, Edit2, Check, X } from "lucide-react";
import { TimelineItem } from "@prisma/client";
import {
  createTimelineAction,
  updateTimelineAction,
  deleteTimelineAction,
} from "@/app/(admin)/admin/honors/actions";

interface Props {
  items: TimelineItem[];
  canDelete: boolean;
}

interface FormState {
  occurredAt: string;
  title: string;
  description: string;
  displayOrder: number;
}

function emptyForm(): FormState {
  return {
    occurredAt: new Date().toISOString().slice(0, 10),
    title: "",
    description: "",
    displayOrder: 0,
  };
}

export function TimelineAdminClient({ items, canDelete }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [editingId, setEditingId] = useState<string | "new" | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm());

  const startEdit = (item: TimelineItem) => {
    setEditingId(item.id);
    setForm({
      occurredAt: new Date(item.occurredAt).toISOString().slice(0, 10),
      title: item.title,
      description: item.description,
      displayOrder: item.displayOrder,
    });
  };

  const startNew = () => {
    setEditingId("new");
    setForm(emptyForm());
  };

  const cancelEdit = () => {
    setEditingId(null);
    setForm(emptyForm());
  };

  const handleSave = () => {
    if (!form.title.trim() || !form.description.trim()) {
      toast.error("Tiêu đề và mô tả không được trống");
      return;
    }

    const input = {
      occurredAt: form.occurredAt,
      title: form.title,
      description: form.description,
      displayOrder: form.displayOrder,
      isPublished: true,
    };

    startTransition(async () => {
      const res =
        editingId === "new"
          ? await createTimelineAction(input)
          : await updateTimelineAction(editingId as string, input);

      if (res.ok) {
        toast.success(editingId === "new" ? "Đã thêm mốc mới" : "Đã cập nhật");
        cancelEdit();
        router.refresh();
      } else {
        toast.error(res.error || "Có lỗi");
      }
    });
  };

  const handleDelete = (id: string) => {
    if (!confirm("Xoá mốc timeline này?")) return;
    startTransition(async () => {
      const res = await deleteTimelineAction(id);
      if (res.ok) {
        toast.success("Đã xoá");
        router.refresh();
      } else {
        toast.error(res.error || "Có lỗi");
      }
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <button
          type="button"
          onClick={startNew}
          disabled={editingId !== null}
          className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-bold text-white hover:opacity-90 disabled:opacity-50"
        >
          <Plus className="h-4 w-4" />
          Thêm mốc mới
        </button>
      </div>

      {editingId === "new" && (
        <TimelineEditCard
          form={form}
          setForm={setForm}
          onSave={handleSave}
          onCancel={cancelEdit}
          isPending={isPending}
        />
      )}

      <div className="space-y-3">
        {items.length === 0 && editingId !== "new" && (
          <p className="rounded-lg border border-dashed border-border p-8 text-center text-muted-foreground">
            Chưa có mốc nào. Bấm &ldquo;Thêm mốc mới&rdquo; để bắt đầu.
          </p>
        )}

        {items.map((item) =>
          editingId === item.id ? (
            <TimelineEditCard
              key={item.id}
              form={form}
              setForm={setForm}
              onSave={handleSave}
              onCancel={cancelEdit}
              isPending={isPending}
            />
          ) : (
            <div
              key={item.id}
              className="rounded-lg border border-border bg-card p-4"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1">
                  <p className="text-xs font-semibold uppercase tracking-wider text-primary">
                    {new Date(item.occurredAt).toLocaleDateString("vi-VN", {
                      year: "numeric",
                      month: "long",
                    })}
                  </p>
                  <h3 className="mt-1 text-lg font-bold">{item.title}</h3>
                  <p className="mt-2 whitespace-pre-wrap text-sm text-foreground">
                    {item.description}
                  </p>
                  <p className="mt-2 text-xs text-muted-foreground">Order: {item.displayOrder}</p>
                </div>
                <div className="flex shrink-0 gap-1">
                  <button
                    type="button"
                    onClick={() => startEdit(item)}
                    disabled={editingId !== null}
                    className="rounded p-1.5 text-state-info-ink hover:bg-state-info-soft disabled:opacity-50"
                    title="Sửa"
                  >
                    <Edit2 className="h-4 w-4" />
                  </button>
                  {canDelete && (
                    <button
                      type="button"
                      onClick={() => handleDelete(item.id)}
                      disabled={isPending || editingId !== null}
                      className="rounded p-1.5 text-state-danger-ink hover:bg-state-danger-soft disabled:opacity-50"
                      title="Xoá"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </div>
              </div>
            </div>
          ),
        )}
      </div>
    </div>
  );
}

function TimelineEditCard({
  form,
  setForm,
  onSave,
  onCancel,
  isPending,
}: {
  form: FormState;
  setForm: (f: FormState) => void;
  onSave: () => void;
  onCancel: () => void;
  isPending: boolean;
}) {
  return (
    <div className="rounded-lg border-2 border-primary bg-primary-soft p-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <div>
          <label className="mb-1 block text-xs font-semibold">Ngày *</label>
          <input
            type="date"
            value={form.occurredAt}
            onChange={(e) => setForm({ ...form, occurredAt: e.target.value })}
            className="w-full rounded border border-border px-2 py-1.5 text-sm"
          />
        </div>
        <div className="sm:col-span-2">
          <label className="mb-1 block text-xs font-semibold">Tiêu đề *</label>
          <input
            type="text"
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
            className="w-full rounded border border-border px-2 py-1.5 text-sm"
          />
        </div>
      </div>

      <div className="mt-3">
        <label className="mb-1 block text-xs font-semibold">Mô tả (Markdown) *</label>
        <textarea
          rows={4}
          value={form.description}
          onChange={(e) => setForm({ ...form, description: e.target.value })}
          className="w-full rounded border border-border px-2 py-1.5 text-sm"
        />
      </div>

      <div className="mt-3 flex items-center justify-between">
        <div>
          <label className="text-xs font-semibold">Display order: </label>
          <input
            type="number"
            value={form.displayOrder}
            onChange={(e) =>
              setForm({ ...form, displayOrder: Number(e.target.value || 0) })
            }
            className="w-16 rounded border border-border px-2 py-1 text-sm"
          />
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={isPending}
            className="inline-flex items-center gap-1 rounded border border-border px-3 py-1.5 text-sm font-semibold text-foreground hover:bg-card"
          >
            <X className="h-3.5 w-3.5" /> Huỷ
          </button>
          <button
            type="button"
            onClick={onSave}
            disabled={isPending}
            className="inline-flex items-center gap-1 rounded bg-primary px-3 py-1.5 text-sm font-bold text-white hover:opacity-90 disabled:opacity-50"
          >
            <Check className="h-3.5 w-3.5" /> Lưu
          </button>
        </div>
      </div>
    </div>
  );
}
