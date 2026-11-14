"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { enrollStudent } from "../_actions";

interface StudentOption {
  id: string;
  name: string;
  parentPhone: string | null;
  studentCode: string | null;
}

interface ClassOption {
  id: string;
  classCode: string | null;
  name: string;
  status: string;
  maxStudents: number;
  enrolledCount: number;
  centerName: string | null;
}

const STATUS_LABEL: Record<string, string> = {
  PLANNED: "Đang lên KH",
  RECRUITING: "Tuyển sinh",
  ACTIVE: "Đang dạy",
  COMPLETED: "Hoàn thành",
  CANCELLED: "Huỷ",
};

// FIX-C4 — map mã lỗi nghiệp vụ từ server action sang thông báo VI.
const ERROR_MESSAGE: Record<string, string> = {
  CLASS_FULL: "Lớp đã đầy — vui lòng chọn lớp khác.",
};

export function EnrollForm({
  students,
  classes,
  initialStudentId = null,
  initialRenewedFrom = null,
  previousEnrollments = [],
}: {
  students: StudentOption[];
  classes: ClassOption[];
  /** BGĐ 31/07 — pre-fill từ nút "Tái tục" (?studentId=&renewedFrom=). */
  initialStudentId?: string | null;
  initialRenewedFrom?: string | null;
  previousEnrollments?: { id: string; label: string }[];
}) {
  const router = useRouter();
  const [studentId, setStudentId] = useState<string>(initialStudentId ?? "");
  const [classId, setClassId] = useState<string>("");
  const [notes, setNotes] = useState<string>("");
  const [renewedFrom, setRenewedFrom] = useState<string>(initialRenewedFrom ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // Picker "khoá trước" chỉ có nghĩa cho HV được pre-fill — đổi HV thì bỏ liên kết.
  const showRenewal = previousEnrollments.length > 0 && studentId === initialStudentId;

  const selectedClass = useMemo(
    () => classes.find((c) => c.id === classId) ?? null,
    [classes, classId],
  );

  const isFull = selectedClass
    ? selectedClass.enrolledCount >= selectedClass.maxStudents
    : false;
  const isClosed =
    selectedClass?.status === "CANCELLED" || selectedClass?.status === "COMPLETED";

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!studentId) return setError("Chọn học viên");
    if (!classId) return setError("Chọn lớp");

    startTransition(async () => {
      const res = await enrollStudent({
        studentId,
        classId,
        notes: notes.trim() || undefined,
        renewedFromEnrollmentId: showRenewal && renewedFrom ? renewedFrom : undefined,
      });
      if (!res.ok) {
        setError(ERROR_MESSAGE[res.error] ?? res.error);
        // FIX-C4 — refetch sĩ số mới nhất khi lớp đã đầy (race).
        if (res.error === "CLASS_FULL") router.refresh();
        return;
      }
      router.push("/enrollments");
      router.refresh();
    });
  }

  return (
    <form onSubmit={handleSubmit} className="max-w-2xl space-y-5">
      {error && (
        <div className="rounded-lg border border-state-danger-soft bg-state-danger-soft px-4 py-3 text-sm text-state-danger-ink">
          {error}
        </div>
      )}

      <section className="rounded-xl border border-border bg-card p-6 space-y-4">
        <label className="block">
          <span className="mb-1 block text-sm font-semibold text-foreground">
            Học viên <span className="text-state-danger-ink">*</span>
          </span>
          <select
            value={studentId}
            onChange={(e) => setStudentId(e.target.value)}
            disabled={pending}
            required
            className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
          >
            <option value="">— Chọn học viên —</option>
            {students.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
                {s.studentCode ? ` · ${s.studentCode}` : ""}
                {s.parentPhone ? ` · ${s.parentPhone}` : ""}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="mb-1 block text-sm font-semibold text-foreground">
            Lớp học <span className="text-state-danger-ink">*</span>
          </span>
          <select
            value={classId}
            onChange={(e) => setClassId(e.target.value)}
            disabled={pending}
            required
            className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
          >
            <option value="">— Chọn lớp —</option>
            {classes.map((c) => {
              const full = c.enrolledCount >= c.maxStudents;
              return (
                <option
                  key={c.id}
                  value={c.id}
                  disabled={full}
                >
                  {c.classCode ? `${c.classCode} · ` : ""}
                  {c.name} · {c.centerName ?? "—"} · {c.enrolledCount}/
                  {c.maxStudents}
                  {full ? " (FULL)" : ""}
                </option>
              );
            })}
          </select>
          {selectedClass && (
            <div className="mt-2 flex flex-wrap items-center gap-3 text-xs">
              <span
                className={
                  "inline-flex rounded-full px-2 py-0.5 font-semibold " +
                  (isFull
                    ? "bg-state-danger-soft text-state-danger-ink"
                    : "bg-state-success-soft text-state-success-ink")
                }
              >
                Còn {Math.max(0, selectedClass.maxStudents - selectedClass.enrolledCount)}/
                {selectedClass.maxStudents} chỗ
              </span>
              <span className="text-muted-foreground">
                Trạng thái lớp:{" "}
                <strong>
                  {STATUS_LABEL[selectedClass.status] ?? selectedClass.status}
                </strong>
              </span>
              {isClosed && (
                <span className="text-state-danger-ink font-semibold">
                  Lớp đã đóng — không nhận đăng ký mới
                </span>
              )}
            </div>
          )}
        </label>

        {showRenewal && (
          <label className="block">
            <span className="mb-1 block text-sm font-semibold text-foreground">
              Khoá trước (tái tục)
            </span>
            <select
              value={renewedFrom}
              onChange={(e) => setRenewedFrom(e.target.value)}
              disabled={pending}
              className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
            >
              <option value="">— Không phải tái tục —</option>
              {previousEnrollments.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
            <p className="mt-1 text-xs text-muted-foreground">
              Ghi danh tái tục sẽ nối về khoá trước của học viên (hoa hồng tái tục
              không tính 4 tầng theo SR.QD.217).
            </p>
          </label>
        )}

        <label className="block">
          <span className="mb-1 block text-sm font-semibold text-foreground">
            Ghi chú
          </span>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="VD: Đăng ký qua campaign 24 suất miễn phí…"
            rows={3}
            disabled={pending}
            className="w-full resize-y rounded-lg border border-border bg-card px-3 py-2 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
          />
        </label>
      </section>

      <div className="flex gap-3">
        <button
          type="submit"
          disabled={pending || isFull || isClosed}
          className="rounded-xl bg-primary px-6 py-3 font-bold text-white shadow-md hover:opacity-90 disabled:opacity-60"
        >
          {pending ? "Đang lưu..." : "Tạo đăng ký"}
        </button>
        <button
          type="button"
          onClick={() => router.push("/enrollments")}
          disabled={pending}
          className="rounded-xl border-2 border-border bg-card px-6 py-3 font-bold text-foreground hover:bg-muted"
        >
          Huỷ
        </button>
      </div>
    </form>
  );
}
