"use client";

// R7-06 — Tab/section "Chương trình": liệt kê ClassSessionPlan của lớp,
// cho sửa tiêu đề/ghi chú + đổi thứ tự (order), và áp dụng version giáo trình mới.
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { BookOpen, ChevronUp, ChevronDown, Save, Layers } from "lucide-react";
import {
  updateSessionPlan,
  adoptCurriculumVersionAction,
} from "../_curriculum-actions";

export type PlanRow = {
  id: string;
  seq: number;
  order: number;
  customTitle: string | null;
  note: string | null;
  lessonTitle: string | null;
};

export type VersionOption = { version: number; name: string };

export function ClassCurriculum({
  classId,
  pinnedVersion,
  plans,
  versions,
  canEdit,
}: {
  classId: string;
  pinnedVersion: number | null;
  plans: PlanRow[];
  versions: VersionOption[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const sorted = [...plans].sort((a, b) => a.order - b.order || a.seq - b.seq);

  function reorder(plan: PlanRow, dir: -1 | 1) {
    const idx = sorted.findIndex((p) => p.id === plan.id);
    const swap = sorted[idx + dir];
    if (!swap) return;
    startTransition(async () => {
      const r1 = await updateSessionPlan(plan.id, { order: swap.order });
      const r2 = await updateSessionPlan(swap.id, { order: plan.order });
      if (r1.ok && r2.ok) router.refresh();
      else toast.error(r1.error ?? r2.error ?? "Không đổi được thứ tự");
    });
  }

  return (
    <section className="rounded-xl border border-border bg-card p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-muted-foreground">
          <BookOpen className="h-4 w-4" /> Chương trình (kế hoạch buổi)
        </h2>
        <span className="inline-flex items-center gap-1 rounded-full bg-primary-soft px-2.5 py-0.5 text-xs font-semibold text-primary">
          <Layers className="h-3.5 w-3.5" />
          Version đang chốt: {pinnedVersion ?? "—"}
        </span>
      </div>

      {canEdit && (
        <AdoptVersion
          classId={classId}
          pinnedVersion={pinnedVersion}
          versions={versions}
        />
      )}

      {sorted.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">
          Chưa có kế hoạch buổi. Lớp tạo mới sẽ tự sinh từ giáo trình đã chốt.
        </p>
      ) : (
        <ul className="mt-3 divide-y divide-border">
          {sorted.map((p, i) => (
            <PlanItem
              key={p.id}
              plan={p}
              canEdit={canEdit}
              pending={pending}
              isFirst={i === 0}
              isLast={i === sorted.length - 1}
              onReorder={reorder}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function AdoptVersion({
  classId,
  pinnedVersion,
  versions,
}: {
  classId: string;
  pinnedVersion: number | null;
  versions: VersionOption[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [version, setVersion] = useState<number | "">("");
  const [reason, setReason] = useState("");

  const others = versions.filter((v) => v.version !== pinnedVersion);
  if (others.length === 0) return null;

  function submit() {
    if (version === "") {
      toast.error("Chọn version muốn áp dụng");
      return;
    }
    if (reason.trim().length < 5) {
      toast.error("Nhập lý do (≥5 ký tự)");
      return;
    }
    startTransition(async () => {
      const res = await adoptCurriculumVersionAction(classId, version, reason.trim());
      if (res.ok) {
        toast.success("Đã áp dụng version giáo trình mới");
        setOpen(false);
        setReason("");
        setVersion("");
        router.refresh();
      } else {
        toast.error(res.error ?? "Không áp dụng được");
      }
    });
  }

  return (
    <div className="rounded-lg border border-dashed border-primary-soft bg-primary-soft/40 p-3">
      {!open ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="text-sm font-semibold text-primary hover:underline"
        >
          Áp dụng version mới…
        </button>
      ) : (
        <div className="space-y-2">
          <div className="flex flex-col gap-2 sm:flex-row">
            <select
              value={version}
              onChange={(e) =>
                setVersion(e.target.value ? Number(e.target.value) : "")
              }
              className="rounded-lg border border-border px-3 py-2 text-sm focus:border-primary focus:outline-none"
            >
              <option value="">— Chọn version —</option>
              {others.map((v) => (
                <option key={v.version} value={v.version}>
                  v{v.version} · {v.name}
                </option>
              ))}
            </select>
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Lý do áp dụng (bắt buộc)"
              className="flex-1 rounded-lg border border-border px-3 py-2 text-sm focus:border-primary focus:outline-none"
            />
          </div>
          <p className="text-xs text-state-warning-ink">
            Áp version mới sẽ sinh lại kế hoạch buổi theo giáo trình mới. Thao tác
            được ghi nhật ký kèm lý do.
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={submit}
              disabled={pending}
              className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
            >
              {pending ? "Đang áp dụng…" : "Áp dụng"}
            </button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-lg border border-border px-4 py-2 text-sm font-semibold text-foreground hover:bg-muted"
            >
              Huỷ
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function PlanItem({
  plan,
  canEdit,
  pending,
  isFirst,
  isLast,
  onReorder,
}: {
  plan: PlanRow;
  canEdit: boolean;
  pending: boolean;
  isFirst: boolean;
  isLast: boolean;
  onReorder: (p: PlanRow, dir: -1 | 1) => void;
}) {
  const router = useRouter();
  const [savePending, startSave] = useTransition();
  const [editing, setEditing] = useState(false);
  const [customTitle, setCustomTitle] = useState(plan.customTitle ?? "");
  const [note, setNote] = useState(plan.note ?? "");

  const title = plan.customTitle || plan.lessonTitle || `Buổi ${plan.seq}`;

  function save() {
    startSave(async () => {
      const res = await updateSessionPlan(plan.id, {
        customTitle,
        note,
      });
      if (res.ok) {
        toast.success("Đã lưu");
        setEditing(false);
        router.refresh();
      } else {
        toast.error(res.error ?? "Không lưu được");
      }
    });
  }

  return (
    <li className="py-3">
      <div className="flex items-start gap-2">
        <div className="flex flex-col items-center pt-0.5">
          <span className="inline-flex h-6 min-w-6 items-center justify-center rounded-full bg-muted px-1.5 text-xs font-bold text-muted-foreground tabular-nums">
            {plan.seq}
          </span>
          {canEdit && (
            <div className="mt-1 flex flex-col">
              <button
                type="button"
                onClick={() => onReorder(plan, -1)}
                disabled={pending || isFirst}
                className="text-muted-foreground hover:text-primary disabled:opacity-30"
                aria-label="Lên"
              >
                <ChevronUp className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => onReorder(plan, 1)}
                disabled={pending || isLast}
                className="text-muted-foreground hover:text-primary disabled:opacity-30"
                aria-label="Xuống"
              >
                <ChevronDown className="h-4 w-4" />
              </button>
            </div>
          )}
        </div>

        <div className="min-w-0 flex-1">
          {!editing ? (
            <>
              <div className="font-medium text-foreground">{title}</div>
              {plan.lessonTitle && plan.customTitle && (
                <div className="text-xs text-muted-foreground">
                  Bài gốc: {plan.lessonTitle}
                </div>
              )}
              {plan.note && (
                <p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">
                  {plan.note}
                </p>
              )}
              {canEdit && (
                <button
                  type="button"
                  onClick={() => setEditing(true)}
                  className="mt-1 text-xs font-semibold text-primary hover:underline"
                >
                  Sửa
                </button>
              )}
            </>
          ) : (
            <div className="space-y-2">
              <input
                value={customTitle}
                onChange={(e) => setCustomTitle(e.target.value)}
                placeholder={plan.lessonTitle ?? "Tiêu đề tuỳ biến"}
                className="w-full rounded-lg border border-border px-3 py-2 text-sm focus:border-primary focus:outline-none"
              />
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={2}
                placeholder="Ghi chú buổi"
                className="w-full resize-y rounded-lg border border-border px-3 py-2 text-sm focus:border-primary focus:outline-none"
              />
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={save}
                  disabled={savePending}
                  className="inline-flex items-center gap-1 rounded-lg bg-primary px-3 py-1.5 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
                >
                  <Save className="h-3.5 w-3.5" />
                  {savePending ? "Đang lưu…" : "Lưu"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setEditing(false);
                    setCustomTitle(plan.customTitle ?? "");
                    setNote(plan.note ?? "");
                  }}
                  className="rounded-lg border border-border px-3 py-1.5 text-sm font-semibold text-foreground hover:bg-muted"
                >
                  Huỷ
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </li>
  );
}
