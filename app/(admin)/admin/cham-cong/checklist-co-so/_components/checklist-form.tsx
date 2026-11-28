"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CheckCircle2, Circle, Save } from "lucide-react";
import { OPEN_FIELDS, CLOSE_FIELDS, ALL_CHECKLIST_KEYS, type ChecklistKey } from "@/lib/center-checklist";
import { saveCenterChecklist } from "../_actions";

export function CenterChecklistForm({
  centerId,
  date,
  initial,
  initialNote,
  canEdit,
}: {
  centerId: string;
  date: string;
  initial: Record<string, boolean>;
  initialNote: string;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [flags, setFlags] = useState<Record<string, boolean>>(() => {
    const f: Record<string, boolean> = {};
    for (const k of ALL_CHECKLIST_KEYS) f[k] = initial[k] === true;
    return f;
  });
  const [note, setNote] = useState(initialNote);

  function toggle(k: ChecklistKey) {
    if (!canEdit) return;
    setFlags((cur) => ({ ...cur, [k]: !cur[k] }));
  }

  function save() {
    startTransition(async () => {
      const res = await saveCenterChecklist({ centerId, date, flags, note: note.trim() });
      if (res.ok) {
        toast.success("Đã lưu checklist");
        router.refresh();
      } else toast.error(res.error);
    });
  }

  const doneCount = ALL_CHECKLIST_KEYS.filter((k) => flags[k]).length;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Section title="Đầu ngày (mở cơ sở)" fields={OPEN_FIELDS} flags={flags} toggle={toggle} disabled={!canEdit || pending} />
        <Section title="Cuối ngày (đóng cơ sở)" fields={CLOSE_FIELDS} flags={flags} toggle={toggle} disabled={!canEdit || pending} />
      </div>

      <label className="block">
        <span className="mb-1 block text-xs font-medium text-muted-foreground">Ghi chú / bất thường</span>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          disabled={!canEdit || pending}
          rows={2}
          className="w-full resize-y rounded-lg border border-border px-3 py-2 text-sm focus:border-primary focus:outline-none disabled:bg-muted"
        />
      </label>

      <div className="flex items-center gap-3">
        {canEdit && (
          <button
            type="button"
            onClick={save}
            disabled={pending}
            className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
          >
            <Save className="h-4 w-4" /> {pending ? "Đang lưu…" : "Lưu checklist"}
          </button>
        )}
        <span className="text-sm text-muted-foreground">{doneCount}/{ALL_CHECKLIST_KEYS.length} mục hoàn tất</span>
      </div>
    </div>
  );
}

function Section({
  title, fields, flags, toggle, disabled,
}: {
  title: string;
  fields: readonly { key: string; label: string }[];
  flags: Record<string, boolean>;
  toggle: (k: ChecklistKey) => void;
  disabled: boolean;
}) {
  return (
    <section className="rounded-xl border border-border bg-card p-4">
      <h2 className="mb-2 text-sm font-bold uppercase tracking-wider text-muted-foreground">{title}</h2>
      <ul className="space-y-1.5">
        {fields.map((f) => {
          const on = flags[f.key];
          return (
            <li key={f.key}>
              <button
                type="button"
                onClick={() => toggle(f.key as ChecklistKey)}
                disabled={disabled}
                className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-muted disabled:opacity-60"
              >
                {on ? <CheckCircle2 className="h-5 w-5 shrink-0 text-state-success-ink" /> : <Circle className="h-5 w-5 shrink-0 text-muted-foreground" />}
                <span className={on ? "text-foreground" : "text-muted-foreground"}>{f.label}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
