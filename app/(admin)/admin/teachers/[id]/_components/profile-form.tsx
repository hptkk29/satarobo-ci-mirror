"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Save } from "lucide-react";
import type { TeacherRank, EmploymentType, TeacherStatus } from "@prisma/client";
import { updateTeacherProfile } from "../../_actions";
import {
  RANK_LABEL,
  EMPLOYMENT_LABEL,
  TEACHER_STATUS_LABEL,
} from "@/lib/teachers/labels";

type CourseOpt = { id: string; label: string };

export function TeacherProfileForm({
  userId,
  initial,
  courses,
  canEdit,
}: {
  userId: string;
  initial: {
    rank: TeacherRank;
    employmentType: EmploymentType;
    status: TeacherStatus;
    bio: string;
    courseIds: string[];
  };
  courses: CourseOpt[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [rank, setRank] = useState<TeacherRank>(initial.rank);
  const [employmentType, setEmploymentType] = useState<EmploymentType>(initial.employmentType);
  const [status, setStatus] = useState<TeacherStatus>(initial.status);
  const [bio, setBio] = useState(initial.bio);
  const [courseIds, setCourseIds] = useState<string[]>(initial.courseIds);

  function toggleCourse(id: string) {
    setCourseIds((cur) =>
      cur.includes(id) ? cur.filter((c) => c !== id) : [...cur, id],
    );
  }

  function save() {
    startTransition(async () => {
      const res = await updateTeacherProfile({
        userId,
        rank,
        employmentType,
        status,
        bio: bio.trim(),
        courseIds,
      });
      if (res.ok) {
        toast.success("Đã lưu hồ sơ chuyên môn");
        router.refresh();
      } else {
        toast.error(res.error);
      }
    });
  }

  const fieldCls =
    "w-full rounded-lg border border-border px-3 py-2 text-sm focus:border-primary focus:outline-none disabled:bg-muted disabled:text-muted-foreground";

  return (
    <section className="rounded-xl border border-border bg-card p-5">
      <h2 className="mb-4 text-sm font-bold uppercase tracking-wider text-muted-foreground">
        Hồ sơ chuyên môn
      </h2>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-muted-foreground">Ngạch</span>
          <select value={rank} onChange={(e) => setRank(e.target.value as TeacherRank)} disabled={!canEdit || pending} className={fieldCls}>
            {(Object.keys(RANK_LABEL) as TeacherRank[]).map((r) => (
              <option key={r} value={r}>{RANK_LABEL[r]}</option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-muted-foreground">Loại hợp đồng</span>
          <select value={employmentType} onChange={(e) => setEmploymentType(e.target.value as EmploymentType)} disabled={!canEdit || pending} className={fieldCls}>
            {(Object.keys(EMPLOYMENT_LABEL) as EmploymentType[]).map((t) => (
              <option key={t} value={t}>{EMPLOYMENT_LABEL[t]}</option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-muted-foreground">Trạng thái</span>
          <select value={status} onChange={(e) => setStatus(e.target.value as TeacherStatus)} disabled={!canEdit || pending} className={fieldCls}>
            {(Object.keys(TEACHER_STATUS_LABEL) as TeacherStatus[]).map((s) => (
              <option key={s} value={s}>{TEACHER_STATUS_LABEL[s]}</option>
            ))}
          </select>
        </label>
      </div>

      <label className="mt-4 block">
        <span className="mb-1 block text-xs font-medium text-muted-foreground">Giới thiệu / ghi chú chuyên môn</span>
        <textarea value={bio} onChange={(e) => setBio(e.target.value)} disabled={!canEdit || pending} rows={3} className={fieldCls} placeholder="VD: thế mạnh, kinh nghiệm thi đấu…" />
      </label>

      <div className="mt-4">
        <span className="mb-2 block text-xs font-medium text-muted-foreground">
          Khoá dạy được ({courseIds.length})
        </span>
        {courses.length === 0 ? (
          <p className="text-sm text-muted-foreground">Chưa có khoá học nào trong hệ thống.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {courses.map((c) => {
              const checked = courseIds.includes(c.id);
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => canEdit && toggleCourse(c.id)}
                  disabled={!canEdit || pending}
                  className={`rounded-full border px-3 py-1 text-xs font-medium ${ checked ? "border-primary bg-primary-soft text-primary" : "border-border bg-card text-muted-foreground" } ${canEdit ? "hover:border-primary" : "cursor-default"}`}
                >
                  {checked ? "✓ " : ""}
                  {c.label}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {canEdit && (
        <div className="mt-5">
          <button
            type="button"
            onClick={save}
            disabled={pending}
            className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
          >
            <Save className="h-4 w-4" />
            {pending ? "Đang lưu…" : "Lưu hồ sơ"}
          </button>
        </div>
      )}
    </section>
  );
}
