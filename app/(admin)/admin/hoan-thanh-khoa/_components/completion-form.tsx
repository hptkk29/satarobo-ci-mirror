"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import type { StudentCourseChain } from "@/lib/enrollment-flow";
import { markCourseCompletion, listStudentCoursesAction } from "../_actions";

type Opt = { id: string; name: string; studentCode?: string | null };

// FL2-06 (LD-7) — dây chuyền liền mạch: HỌC VIÊN → KHOÁ đang học → LỚP. Chọn HV thì
// nạp khoá HV đang theo (server action, không useEffect-fetch); chọn khoá thì lọc lớp.
export function CompletionForm({ students }: { students: Opt[] }) {
  const [studentId, setStudentId] = useState("");
  const [chain, setChain] = useState<StudentCourseChain[] | null>(null);
  const [courseId, setCourseId] = useState("");
  const [classId, setClassId] = useState("");
  const [finalGrade, setFinalGrade] = useState("");
  const [finalAssessment, setFinalAssessment] = useState("");
  const [loading, startLoad] = useTransition();
  const [pending, start] = useTransition();

  const courses = chain ?? [];
  const selectedCourse = courses.find((c) => c.courseId === courseId) ?? null;
  const classes = selectedCourse?.classes ?? [];

  function onPickStudent(value: string) {
    setStudentId(value);
    setCourseId("");
    setClassId("");
    setChain(null);
    if (!value) return;
    startLoad(async () => {
      const res = await listStudentCoursesAction(value);
      if (!res.ok) {
        toast.error(res.error ?? "Không nạp được khoá đang học");
        return;
      }
      setChain(res.chain ?? []);
    });
  }

  function onPickCourse(value: string) {
    setCourseId(value);
    // Auto-chọn lớp nếu khoá chỉ có 1 lớp (giảm thao tác).
    const next = courses.find((c) => c.courseId === value);
    setClassId(next && next.classes.length === 1 ? next.classes[0].classId : "");
  }

  function submit() {
    if (!studentId || !courseId) {
      toast.error("Chọn học viên và khoá");
      return;
    }
    if (!finalAssessment.trim()) {
      toast.error("Nhập đánh giá cuối khoá của GV");
      return;
    }
    start(async () => {
      const res = await markCourseCompletion({
        studentId,
        courseId,
        classId: classId || undefined,
        finalGrade,
        finalAssessment,
      });
      if (res.ok) {
        toast.success(`Đã hoàn thành khoá. Chứng chỉ: ${res.certificateCode}`);
        setCourseId("");
        setClassId("");
        setChain(null);
        setStudentId("");
        setFinalGrade("");
        setFinalAssessment("");
      } else {
        toast.error(res.error ?? "Lỗi");
      }
    });
  }

  return (
    <div className="grid gap-3 rounded-xl border border-border bg-card p-4 sm:grid-cols-2">
      <label className="text-sm">
        <span className="mb-1 block text-muted-foreground">Bước 1 — Học viên</span>
        <select
          value={studentId}
          onChange={(e) => onPickStudent(e.target.value)}
          disabled={loading || pending}
          className="w-full rounded-md border border-border px-3 py-2 text-sm disabled:opacity-50"
        >
          <option value="">— Chọn —</option>
          {students.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
              {s.studentCode ? ` (${s.studentCode})` : ""}
            </option>
          ))}
        </select>
      </label>

      <label className="text-sm">
        <span className="mb-1 block text-muted-foreground">Bước 2 — Khoá đang học</span>
        <select
          value={courseId}
          onChange={(e) => onPickCourse(e.target.value)}
          disabled={!studentId || loading || pending}
          className="w-full rounded-md border border-border px-3 py-2 text-sm disabled:bg-muted"
        >
          <option value="">
            {!studentId
              ? "— Chọn học viên trước —"
              : loading
                ? "Đang nạp khoá…"
                : courses.length === 0
                  ? "— HV không có khoá đang học —"
                  : "— Chọn —"}
          </option>
          {courses.map((c) => (
            <option key={c.courseId} value={c.courseId}>
              {c.courseName}
            </option>
          ))}
        </select>
      </label>

      <label className="text-sm sm:col-span-2">
        <span className="mb-1 block text-muted-foreground">Bước 3 — Lớp (theo khoá)</span>
        <select
          value={classId}
          onChange={(e) => setClassId(e.target.value)}
          disabled={!courseId || pending}
          className="w-full rounded-md border border-border px-3 py-2 text-sm disabled:bg-muted"
        >
          <option value="">{!courseId ? "— Chọn khoá trước —" : "— Chọn lớp —"}</option>
          {classes.map((c) => (
            <option key={c.classId} value={c.classId}>
              {c.label}
            </option>
          ))}
        </select>
      </label>

      <label className="text-sm">
        <span className="mb-1 block text-muted-foreground">Xếp loại cuối khoá</span>
        <input
          value={finalGrade}
          onChange={(e) => setFinalGrade(e.target.value)}
          placeholder="Giỏi / Khá / Xuất sắc…"
          className="w-full rounded-md border border-border px-3 py-2 text-sm"
        />
      </label>

      <label className="text-sm sm:col-span-2">
        <span className="mb-1 block text-muted-foreground">Đánh giá cuối khoá của GV *</span>
        <textarea
          value={finalAssessment}
          onChange={(e) => setFinalAssessment(e.target.value)}
          rows={3}
          placeholder="Nhận xét quá trình học, kỹ năng đạt được, gợi ý phát triển…"
          className="w-full rounded-md border border-border px-3 py-2 text-sm"
        />
      </label>

      <div className="sm:col-span-2">
        <button
          onClick={submit}
          disabled={pending || loading}
          className="rounded-md bg-primary-dark px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {pending ? "Đang xử lý…" : "Đánh dấu hoàn thành & sinh chứng chỉ"}
        </button>
      </div>
    </div>
  );
}
