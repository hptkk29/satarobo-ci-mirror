"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { bulkCompleteByClass } from "../_actions";

type ClassOpt = {
  id: string;
  name: string;
  classCode: string | null;
  courseName: string;
  centerName: string | null;
};

type StudentRow = {
  id: string;
  name: string;
  studentCode: string | null;
  alreadyCompleted: boolean;
};

type SelectedClass = {
  id: string;
  name: string;
  courseName: string;
  students: StudentRow[];
};

export function BulkCompleteByClass({
  classes,
  selectedClassId,
  selectedClass,
}: {
  classes: ClassOpt[];
  selectedClassId: string;
  selectedClass: SelectedClass | null;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [navPending, startNav] = useTransition();
  const [finalGrade, setFinalGrade] = useState("");
  const [finalAssessment, setFinalAssessment] = useState("");

  // Học viên được chọn để hoàn thành. Mặc định check sẵn các HV CHƯA hoàn thành.
  const [checked, setChecked] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!selectedClass) {
      setChecked(new Set());
      return;
    }
    setChecked(
      new Set(selectedClass.students.filter((s) => !s.alreadyCompleted).map((s) => s.id)),
    );
  }, [selectedClass]);

  function onPickClass(value: string) {
    startNav(() => {
      router.push(value ? `/admin/hoan-thanh-khoa?classId=${encodeURIComponent(value)}` : "/admin/hoan-thanh-khoa");
    });
  }

  function toggle(id: string) {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectAllEligible() {
    if (!selectedClass) return;
    setChecked(new Set(selectedClass.students.filter((s) => !s.alreadyCompleted).map((s) => s.id)));
  }

  function clearAll() {
    setChecked(new Set());
  }

  function submit() {
    if (!selectedClass) return;
    const studentIds = Array.from(checked);
    if (studentIds.length === 0) {
      toast.error("Chưa chọn học viên nào");
      return;
    }
    start(async () => {
      const res = await bulkCompleteByClass({
        classId: selectedClass.id,
        studentIds,
        finalGrade,
        finalAssessment,
      });
      if (!res.ok) {
        toast.error(res.error ?? "Lỗi");
        return;
      }
      const parts = [`Hoàn thành ${res.created}`];
      if (res.skipped > 0) parts.push(`bỏ qua ${res.skipped} (đã có chứng chỉ)`);
      if (res.errors.length > 0) parts.push(`lỗi ${res.errors.length}`);
      if (res.errors.length > 0) toast.error(parts.join(" · "));
      else toast.success(parts.join(" · "));
      setFinalGrade("");
      setFinalAssessment("");
      router.refresh();
    });
  }

  const eligibleSelected = selectedClass
    ? selectedClass.students.filter((s) => checked.has(s.id) && !s.alreadyCompleted).length
    : 0;

  return (
    <div className="space-y-4 rounded-xl border border-border bg-card p-4">
      <div>
        <h2 className="text-base font-semibold text-foreground">Hoàn thành khoá hàng loạt theo lớp</h2>
        <p className="text-sm text-muted-foreground">
          Chọn lớp → hệ thống nạp học viên đang theo học và khoá của lớp. Bỏ tick những học viên muốn loại,
          rồi xác nhận để sinh chứng chỉ đồng loạt. Học viên đã có chứng chỉ khoá này sẽ được bỏ qua.
        </p>
      </div>

      {/* Bước 1 — chọn lớp */}
      <label className="block text-sm">
        <span className="mb-1 block text-muted-foreground">Bước 1 — Chọn lớp</span>
        <select
          value={selectedClassId}
          onChange={(e) => onPickClass(e.target.value)}
          disabled={navPending}
          className="w-full max-w-xl rounded-md border border-border px-3 py-2 text-sm disabled:opacity-50"
        >
          <option value="">— Chọn lớp —</option>
          {classes.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
              {c.classCode ? ` (${c.classCode})` : ""} · {c.courseName}
              {c.centerName ? ` · ${c.centerName}` : ""}
            </option>
          ))}
        </select>
      </label>

      {navPending && <p className="text-sm text-muted-foreground">Đang nạp học viên…</p>}

      {selectedClassId && !selectedClass && !navPending && (
        <p className="text-sm text-state-danger-ink">Không tìm thấy lớp (hoặc ngoài phạm vi cơ sở của bạn).</p>
      )}

      {/* Bước 2 + 3 — danh sách học viên với checkbox */}
      {selectedClass && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-3">
            <div className="text-sm text-foreground">
              <span className="font-medium">{selectedClass.name}</span> · Khoá{" "}
              <span className="font-medium">{selectedClass.courseName}</span> ·{" "}
              {selectedClass.students.length} học viên
            </div>
            <div className="flex gap-2 text-xs">
              <button
                type="button"
                onClick={selectAllEligible}
                className="rounded border border-border px-2 py-1 text-muted-foreground hover:bg-muted"
              >
                Chọn tất cả (chưa hoàn thành)
              </button>
              <button
                type="button"
                onClick={clearAll}
                className="rounded border border-border px-2 py-1 text-muted-foreground hover:bg-muted"
              >
                Bỏ chọn hết
              </button>
            </div>
          </div>

          {selectedClass.students.length === 0 ? (
            <p className="text-sm text-muted-foreground">Lớp chưa có học viên đang theo học.</p>
          ) : (
            <ul className="divide-y rounded-md border border-border">
              {selectedClass.students.map((s) => (
                <li key={s.id} className="flex items-center gap-3 px-3 py-2 text-sm">
                  <input
                    type="checkbox"
                    checked={checked.has(s.id)}
                    onChange={() => toggle(s.id)}
                    className="h-4 w-4"
                  />
                  <span className="font-medium text-foreground">{s.name}</span>
                  {s.studentCode && <span className="text-muted-foreground">({s.studentCode})</span>}
                  {s.alreadyCompleted && (
                    <span className="ml-auto rounded bg-state-warning-soft px-2 py-0.5 text-xs text-state-warning-ink">
                      Đã có chứng chỉ — sẽ bỏ qua
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}

          {/* Đánh giá/xếp loại áp dụng chung cho cả đợt (tuỳ chọn) */}
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-sm">
              <span className="mb-1 block text-muted-foreground">Xếp loại cuối khoá (áp dụng chung)</span>
              <input
                value={finalGrade}
                onChange={(e) => setFinalGrade(e.target.value)}
                placeholder="Giỏi / Khá / Xuất sắc…"
                className="w-full rounded-md border border-border px-3 py-2 text-sm"
              />
            </label>
            <label className="text-sm sm:col-span-2">
              <span className="mb-1 block text-muted-foreground">Đánh giá cuối khoá (áp dụng chung — tuỳ chọn)</span>
              <textarea
                value={finalAssessment}
                onChange={(e) => setFinalAssessment(e.target.value)}
                rows={2}
                placeholder="Nhận xét chung cho cả lớp (có thể để trống)…"
                className="w-full rounded-md border border-border px-3 py-2 text-sm"
              />
            </label>
          </div>

          {/* Tóm tắt trước khi xác nhận */}
          <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-3">
            <p className="text-sm text-muted-foreground">
              Sẽ hoàn thành <span className="font-semibold text-primary">{eligibleSelected}</span> học viên.
            </p>
            <button
              type="button"
              onClick={submit}
              disabled={pending || eligibleSelected === 0}
              className="rounded-md bg-primary-dark px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              {pending ? "Đang xử lý…" : `Hoàn thành ${eligibleSelected} học viên & sinh chứng chỉ`}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
