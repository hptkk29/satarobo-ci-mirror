"use client";

import { useState, useTransition } from "react";
import { eraseStudentAction, exportStudentAction } from "../actions";

// C6/NĐ13 — nút Xuất dữ liệu (tải JSON) + Xoá ẩn danh (nhập lý do, xác nhận).
export function StudentComplianceActions({ studentId }: { studentId: string }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);

  function exportData() {
    setMsg(null);
    start(async () => {
      const res = await exportStudentAction(studentId);
      if (!res.ok || !res.data) {
        setMsg(res.error ?? "Lỗi");
        return;
      }
      const blob = new Blob([JSON.stringify(res.data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `student-${studentId}.json`;
      a.click();
      URL.revokeObjectURL(url);
    });
  }

  function erase() {
    const reason = window.prompt("Lý do xoá (ẩn danh) dữ liệu cá nhân (≥ 5 ký tự):");
    if (!reason) return;
    if (!window.confirm("XÁC NHẬN: xoá ẩn danh PII học viên này? Không thể hoàn tác.")) return;
    setMsg(null);
    start(async () => {
      const res = await eraseStudentAction(studentId, reason);
      setMsg(res.ok ? "Đã xoá ẩn danh" : res.error ?? "Lỗi");
    });
  }

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={exportData}
        disabled={pending}
        className="rounded border px-2 py-1 text-xs disabled:opacity-50"
      >
        Xuất dữ liệu
      </button>
      <button
        type="button"
        onClick={erase}
        disabled={pending}
        className="rounded border border-state-danger px-2 py-1 text-xs text-state-danger-ink disabled:opacity-50"
      >
        Xoá (ẩn danh)
      </button>
      {msg && <span className="text-xs text-muted-foreground">{msg}</span>}
    </div>
  );
}
