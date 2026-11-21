"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CalendarPlus, BarChart3, Lock, Unlock } from "lucide-react";
import { createRoundAction, setRoundStatusAction } from "../_actions";

type Scope = "TEACHER_EVAL" | "CENTER_SURVEY" | "SESSION_EVAL";

export type RoundRow = {
  id: string;
  name: string;
  scope: Scope;
  status: "DRAFT" | "OPEN" | "CLOSED";
  formTitle: string;
  centerName: string | null;
  responses: number;
};

type Opt = { id: string; name: string };

const SCOPE_TAG: Record<Scope, string> = {
  TEACHER_EVAL: "GV",
  CENTER_SURVEY: "Cơ sở",
  SESSION_EVAL: "Buổi học",
};

const STATUS_STYLE = {
  DRAFT: "bg-muted text-muted-foreground",
  OPEN: "bg-state-success-soft text-state-success-ink",
  CLOSED: "bg-state-danger-soft text-state-danger-ink",
} as const;
const STATUS_LABEL: Record<keyof typeof STATUS_STYLE, string> = {
  DRAFT: "Nháp",
  OPEN: "Đang mở",
  CLOSED: "Đã đóng",
};

export function RoundsManager({
  rounds,
  forms,
  centers,
  courses,
}: {
  rounds: RoundRow[];
  forms: { id: string; title: string; scope: Scope }[];
  centers: Opt[];
  courses: Opt[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [creating, setCreating] = useState(false);
  const [formId, setFormId] = useState("");
  const [name, setName] = useState("");
  const [centerId, setCenterId] = useState("");
  const [courseId, setCourseId] = useState("");
  const [opensAt, setOpensAt] = useState("");
  const [closesAt, setClosesAt] = useState("");

  const selectedForm = forms.find((f) => f.id === formId);
  const scope = selectedForm?.scope;

  function submit() {
    if (!selectedForm) {
      toast.error("Chọn form");
      return;
    }
    startTransition(async () => {
      const res = await createRoundAction({
        formId,
        name,
        scope: selectedForm.scope,
        centerId: centerId || null,
        courseId: courseId || null,
        opensAt: opensAt || null,
        closesAt: closesAt || null,
      });
      if (res.ok) {
        toast.success("Đã tạo đợt");
        setCreating(false);
        setName("");
        router.refresh();
      } else toast.error(res.error);
    });
  }

  function setStatus(id: string, status: "OPEN" | "CLOSED" | "DRAFT", msg: string) {
    startTransition(async () => {
      const res = await setRoundStatusAction(id, status);
      if (res.ok) {
        toast.success(msg);
        router.refresh();
      } else toast.error(res.error ?? "Lỗi");
    });
  }

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-bold uppercase tracking-wider text-muted-foreground">Đợt đánh giá / khảo sát</h2>
        <button
          type="button"
          onClick={() => setCreating((c) => !c)}
          className="inline-flex items-center gap-1.5 rounded-lg bg-primary-dark px-3 py-1.5 text-sm font-semibold text-white hover:bg-primary-darker"
        >
          <CalendarPlus className="h-4 w-4" /> Tạo đợt
        </button>
      </div>

      {creating && (
        <div className="space-y-2 rounded-xl border border-border bg-card p-4">
          <select
            value={formId}
            onChange={(e) => setFormId(e.target.value)}
            className="w-full rounded-md border border-border px-3 py-2 text-sm"
          >
            <option value="">— Chọn form (đang kích hoạt) —</option>
            {forms.map((f) => (
              <option key={f.id} value={f.id}>
                {f.title} ({SCOPE_TAG[f.scope]})
              </option>
            ))}
          </select>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Tên đợt (vd: Giữa khóa Sata 3 — CS1)…"
            className="w-full rounded-md border border-border px-3 py-2 text-sm"
          />
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <select
              value={centerId}
              onChange={(e) => setCenterId(e.target.value)}
              className="rounded-md border border-border px-3 py-2 text-sm"
            >
              <option value="">{scope === "CENTER_SURVEY" ? "— Chọn cơ sở (bắt buộc) —" : "— Cơ sở (tuỳ chọn) —"}</option>
              {centers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            {scope !== "CENTER_SURVEY" && (
              <select
                value={courseId}
                onChange={(e) => setCourseId(e.target.value)}
                className="rounded-md border border-border px-3 py-2 text-sm"
              >
                <option value="">— Khóa (tuỳ chọn) —</option>
                {courses.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            )}
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <label className="text-xs text-muted-foreground">
              Mở từ
              <input
                type="datetime-local"
                value={opensAt}
                onChange={(e) => setOpensAt(e.target.value)}
                className="mt-0.5 w-full rounded-md border border-border px-2 py-1.5 text-sm"
              />
            </label>
            <label className="text-xs text-muted-foreground">
              Đóng lúc
              <input
                type="datetime-local"
                value={closesAt}
                onChange={(e) => setClosesAt(e.target.value)}
                className="mt-0.5 w-full rounded-md border border-border px-2 py-1.5 text-sm"
              />
            </label>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={submit}
              disabled={pending}
              className="rounded-lg bg-primary-dark px-4 py-2 text-sm font-semibold text-white hover:bg-primary-darker disabled:opacity-60"
            >
              {pending ? "Đang lưu…" : "Lưu đợt"}
            </button>
            <button
              type="button"
              onClick={() => setCreating(false)}
              className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-muted-foreground"
            >
              Huỷ
            </button>
          </div>
        </div>
      )}

      <div className="overflow-hidden rounded-xl border border-border bg-card">
        {rounds.length === 0 ? (
          <p className="p-6 text-center text-sm text-muted-foreground">Chưa có đợt nào.</p>
        ) : (
          <ul className="divide-y divide-border">
            {rounds.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 p-3">
                <div className="min-w-0">
                  <p className="font-medium text-foreground">{r.name}</p>
                  <div className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
                    <span className={`rounded px-1.5 py-0.5 ${STATUS_STYLE[r.status]}`}>{STATUS_LABEL[r.status] ?? r.status}</span>
                    <span>{r.formTitle}</span>
                    {r.centerName && <span>· {r.centerName}</span>}
                    <span>· {r.responses} phản hồi</span>
                  </div>
                </div>
                <div className="flex items-center gap-1.5">
                  {r.status !== "OPEN" && (
                    <button
                      type="button"
                      onClick={() => setStatus(r.id, "OPEN", "Đã mở đợt")}
                      className="inline-flex items-center gap-1 rounded-md border border-state-success-soft px-2 py-1 text-xs font-medium text-state-success-ink hover:bg-state-success-soft"
                    >
                      <Unlock className="h-3.5 w-3.5" /> Mở
                    </button>
                  )}
                  {r.status === "OPEN" && (
                    <button
                      type="button"
                      onClick={() => setStatus(r.id, "CLOSED", "Đã đóng đợt")}
                      className="inline-flex items-center gap-1 rounded-md border border-state-danger-soft px-2 py-1 text-xs font-medium text-state-danger-ink hover:bg-state-danger-soft"
                    >
                      <Lock className="h-3.5 w-3.5" /> Đóng
                    </button>
                  )}
                  <Link
                    href={`/evaluations/results/${r.id}`}
                    className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs font-medium text-muted-foreground hover:bg-muted"
                  >
                    <BarChart3 className="h-3.5 w-3.5" /> Kết quả
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
