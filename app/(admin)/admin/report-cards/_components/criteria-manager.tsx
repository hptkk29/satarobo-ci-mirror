"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { createCriterionAction, toggleCriterionAction } from "../_actions";

type Criterion = { id: string; courseId: string; name: string; order: number; active: boolean };
type CourseRow = { id: string; name: string; isTeachable: boolean; criteria: Criterion[] };

export function CriteriaManager({ courses }: { courses: CourseRow[] }) {
  const [pending, startTransition] = useTransition();
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  function add(courseId: string) {
    const name = (drafts[courseId] ?? "").trim();
    if (!name) {
      toast.error("Nhập tên tiêu chí");
      return;
    }
    startTransition(async () => {
      const res = await createCriterionAction({ courseId, name, order: 0 });
      if (res.ok) {
        toast.success("Đã thêm tiêu chí");
        setDrafts((d) => ({ ...d, [courseId]: "" }));
      } else toast.error(res.error);
    });
  }

  function toggle(id: string, active: boolean) {
    startTransition(async () => {
      const res = await toggleCriterionAction({ id, active });
      if (res.ok) toast.success(active ? "Đã bật" : "Đã tắt");
      else toast.error(res.error);
    });
  }

  return (
    <div className="space-y-3">
      {courses.map((course) => (
        <section key={course.id} className="rounded-xl border border-border bg-card p-4">
          <div className="mb-2 flex items-center gap-2">
            <h2 className="text-sm font-semibold text-foreground">{course.name}</h2>
            {course.isTeachable ? (
              <span className="rounded-full bg-primary-soft px-2 py-0.5 text-[10px] font-medium text-primary">
                Khoá dạy
              </span>
            ) : null}
          </div>

          {course.criteria.length === 0 ? (
            <p className="mb-2 text-sm text-muted-foreground">Chưa có tiêu chí.</p>
          ) : (
            <ul className="mb-2 divide-y text-sm">
              {course.criteria.map((c) => (
                <li key={c.id} className="flex items-center justify-between py-1.5">
                  <span className={c.active ? "" : "text-muted-foreground line-through"}>{c.name}</span>
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => toggle(c.id, !c.active)}
                    className="text-xs font-medium text-primary disabled:opacity-50"
                  >
                    {c.active ? "Tắt" : "Bật"}
                  </button>
                </li>
              ))}
            </ul>
          )}

          <div className="flex gap-2">
            <input
              value={drafts[course.id] ?? ""}
              placeholder="Tên tiêu chí mới"
              onChange={(e) => setDrafts((d) => ({ ...d, [course.id]: e.target.value }))}
              className="flex-1 rounded-md border border-border px-3 py-2 text-sm"
            />
            <button
              type="button"
              disabled={pending}
              onClick={() => add(course.id)}
              className="rounded-md bg-neutral-800 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              Thêm
            </button>
          </div>
        </section>
      ))}
    </div>
  );
}
