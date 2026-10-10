"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AlertTriangle, Plus, X } from "lucide-react";
import { assignClassToTeacher, unassignClassFromTeacher } from "../../_actions";

type ClassRow = { id: string; label: string; courseName: string };
type Assignable = { id: string; label: string; courseId: string; courseName: string };

export function ClassAssignmentSection({
  teacherUserId,
  teacherCourseIds,
  mainClasses,
  assistantClasses,
  assignable,
  canEdit,
}: {
  teacherUserId: string;
  teacherCourseIds: string[];
  mainClasses: ClassRow[];
  assistantClasses: ClassRow[];
  assignable: Assignable[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [pick, setPick] = useState("");
  const [as, setAs] = useState<"teacher" | "assistant">("teacher");

  const teachable = useMemo(() => new Set(teacherCourseIds), [teacherCourseIds]);
  const picked = assignable.find((c) => c.id === pick);
  const warnOutOfScope = picked ? !teachable.has(picked.courseId) : false;

  function add() {
    if (!pick) {
      toast.error("Chọn lớp để gán");
      return;
    }
    startTransition(async () => {
      const res = await assignClassToTeacher({ classId: pick, teacherUserId, as });
      if (res.ok) {
        toast.success(`Đã gán lớp (${as === "teacher" ? "GV chính" : "trợ giảng"})`);
        setPick("");
        router.refresh();
      } else {
        toast.error(res.error);
      }
    });
  }

  function remove(classId: string, role: "teacher" | "assistant") {
    startTransition(async () => {
      const res = await unassignClassFromTeacher({ classId, teacherUserId, as: role });
      if (res.ok) {
        toast.success("Đã gỡ khỏi lớp");
        router.refresh();
      } else {
        toast.error(res.error);
      }
    });
  }

  return (
    <section className="rounded-xl border border-border bg-card p-5">
      <h2 className="mb-4 text-sm font-bold uppercase tracking-wider text-muted-foreground">
        Lớp đang phụ trách
      </h2>

      <ClassList title="GV chính" rows={mainClasses} role="teacher" canEdit={canEdit} pending={pending} onRemove={remove} />
      <div className="mt-4">
        <ClassList title="Trợ giảng" rows={assistantClasses} role="assistant" canEdit={canEdit} pending={pending} onRemove={remove} />
      </div>

      {canEdit && (
        <div className="mt-5 border-t border-border pt-4">
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={pick}
              onChange={(e) => setPick(e.target.value)}
              disabled={pending}
              className="min-w-[16rem] rounded-lg border border-border px-3 py-1.5 text-sm focus:border-primary focus:outline-none"
            >
              <option value="">— Chọn lớp để gán —</option>
              {assignable.map((c) => (
                <option key={c.id} value={c.id}>{c.label}</option>
              ))}
            </select>
            <select
              value={as}
              onChange={(e) => setAs(e.target.value as "teacher" | "assistant")}
              disabled={pending}
              className="rounded-lg border border-border px-3 py-1.5 text-sm focus:border-primary focus:outline-none"
            >
              <option value="teacher">GV chính</option>
              <option value="assistant">Trợ giảng</option>
            </select>
            <button
              type="button"
              onClick={add}
              disabled={pending || !pick}
              className="inline-flex items-center gap-1 rounded-lg bg-primary px-3 py-1.5 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
            >
              <Plus className="h-4 w-4" /> Gán
            </button>
          </div>
          {warnOutOfScope && (
            <p className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-state-warning-soft px-3 py-1.5 text-xs font-medium text-state-warning-ink">
              <AlertTriangle className="h-3.5 w-3.5" />
              GV chưa được đánh dấu dạy được khoá “{picked?.courseName}”. Vẫn gán được nhưng nên kiểm tra năng lực.
            </p>
          )}
          {assignable.length === 0 && (
            <p className="mt-2 text-xs text-muted-foreground">Không còn lớp nào để gán (cùng cơ sở).</p>
          )}
        </div>
      )}
    </section>
  );
}

function ClassList({
  title,
  rows,
  role,
  canEdit,
  pending,
  onRemove,
}: {
  title: string;
  rows: ClassRow[];
  role: "teacher" | "assistant";
  canEdit: boolean;
  pending: boolean;
  onRemove: (classId: string, role: "teacher" | "assistant") => void;
}) {
  return (
    <div>
      <p className="mb-1.5 text-xs font-semibold text-muted-foreground">{title} ({rows.length})</p>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">—</p>
      ) : (
        <ul className="flex flex-wrap gap-2">
          {rows.map((c) => (
            <li
              key={c.id}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-muted px-3 py-1.5 text-sm"
            >
              <span className="font-medium text-foreground">{c.label}</span>
              <span className="text-xs text-muted-foreground">· {c.courseName}</span>
              {canEdit && (
                <button
                  type="button"
                  onClick={() => onRemove(c.id, role)}
                  disabled={pending}
                  className="ml-1 rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
                  aria-label={`Gỡ ${c.label}`}
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
