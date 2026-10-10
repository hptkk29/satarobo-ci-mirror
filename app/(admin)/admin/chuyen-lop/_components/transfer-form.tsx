"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { listEligibleClassesAction, createTransferRequestAction } from "../_actions";

type StudentOpt = {
  id: string;
  name: string;
  studentCode: string | null;
  classes: { classId: string; label: string }[];
};
type EligibleClass = {
  classId: string;
  name: string;
  classCode: string | null;
  centerName: string | null;
  coveredLessons: number;
  openSeats: number;
};

export function TransferForm({
  students,
  centers,
  fromCenterId,
}: {
  students: StudentOpt[];
  centers: { id: string; name: string }[];
  fromCenterId: string;
}) {
  const router = useRouter();
  const [studentId, setStudentId] = useState("");
  const [fromClassId, setFromClassId] = useState("");
  const [toCenterId, setToCenterId] = useState("");
  const [toClassId, setToClassId] = useState("");
  const [reason, setReason] = useState("");
  const [eligible, setEligible] = useState<EligibleClass[] | null>(null);
  const [studentCovered, setStudentCovered] = useState<number | null>(null);
  const [pending, start] = useTransition();
  const [navPending, startNav] = useTransition();

  const student = students.find((s) => s.id === studentId);

  // FL2-06 (LD-6) — chọn CƠ SỞ NGUỒN trước → server nạp HV thuộc cơ sở đó (qua URL
  // param, RSC refetch). Đổi cơ sở thì reset các bước phụ thuộc phía dưới.
  function onPickFromCenter(value: string) {
    setStudentId("");
    setFromClassId("");
    setEligible(null);
    startNav(() => {
      // URL sạch (không tiền tố /admin) như mọi link nội bộ khác — tránh thanh địa chỉ
      // nhảy sang /admin/chuyen-lop rồi bị proxy redirect trên host admin.
      router.push(value ? `/chuyen-lop?fromCenterId=${encodeURIComponent(value)}` : "/chuyen-lop");
    });
  }

  function search() {
    if (!studentId || !fromClassId) {
      toast.error("Chọn học viên và lớp hiện tại");
      return;
    }
    start(async () => {
      const res = await listEligibleClassesAction({ studentId, fromClassId, toCenterId: toCenterId || undefined });
      if (res.ok) {
        setEligible((res.classes as EligibleClass[]) ?? []);
        setStudentCovered(res.studentCovered ?? null);
        setToClassId("");
      } else {
        toast.error(res.error ?? "Lỗi");
      }
    });
  }

  function submit() {
    if (!studentId || !fromClassId) return;
    start(async () => {
      const res = await createTransferRequestAction({ studentId, fromClassId, toClassId, toCenterId, reason });
      if (res.ok) {
        toast.success(res.waitlisted ? "Đã đưa vào danh sách chờ (chưa có lớp)" : "Đã tạo yêu cầu chuyển — chờ duyệt");
        setEligible(null);
        setToClassId("");
        setReason("");
      } else {
        toast.error(res.error ?? "Lỗi");
      }
    });
  }

  return (
    <div className="grid gap-3 rounded-xl border border-border bg-card p-4 sm:grid-cols-2">
      <label className="text-sm">
        <span className="mb-1 block text-muted-foreground">Bước 1 — Cơ sở nguồn</span>
        <select
          value={fromCenterId}
          onChange={(e) => onPickFromCenter(e.target.value)}
          disabled={navPending}
          className="w-full rounded-md border border-border px-3 py-2 text-sm disabled:opacity-50"
        >
          <option value="">— Chọn cơ sở —</option>
          {centers.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </label>

      <label className="text-sm">
        <span className="mb-1 block text-muted-foreground">Bước 2 — Học viên</span>
        <select
          value={studentId}
          onChange={(e) => {
            setStudentId(e.target.value);
            setFromClassId("");
            setEligible(null);
          }}
          disabled={!fromCenterId || navPending}
          className="w-full rounded-md border border-border px-3 py-2 text-sm disabled:bg-muted"
        >
          <option value="">
            {!fromCenterId
              ? "— Chọn cơ sở nguồn trước —"
              : navPending
                ? "Đang nạp học viên…"
                : students.length === 0
                  ? "— Cơ sở chưa có HV đang học —"
                  : "— Chọn —"}
          </option>
          {students.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
              {s.studentCode ? ` (${s.studentCode})` : ""}
            </option>
          ))}
        </select>
      </label>

      <label className="text-sm">
        <span className="mb-1 block text-muted-foreground">Bước 3 — Lớp hiện tại</span>
        <select
          value={fromClassId}
          onChange={(e) => {
            setFromClassId(e.target.value);
            setEligible(null);
          }}
          disabled={!student}
          className="w-full rounded-md border border-border px-3 py-2 text-sm disabled:bg-muted"
        >
          <option value="">— Chọn —</option>
          {student?.classes.map((c) => (
            <option key={c.classId} value={c.classId}>
              {c.label}
            </option>
          ))}
        </select>
      </label>

      <label className="text-sm">
        <span className="mb-1 block text-muted-foreground">Bước 4 — Cơ sở đích (tuỳ chọn)</span>
        <select
          value={toCenterId}
          onChange={(e) => setToCenterId(e.target.value)}
          className="w-full rounded-md border border-border px-3 py-2 text-sm"
        >
          <option value="">— Mọi cơ sở —</option>
          {centers.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </label>

      <div className="flex items-end">
        <button
          onClick={search}
          disabled={pending}
          className="rounded-md bg-neutral-800 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          Tìm lớp đích phù hợp
        </button>
      </div>

      {eligible ? (
        <div className="sm:col-span-2">
          <p className="mb-1 text-xs text-muted-foreground">
            Tiến độ học viên: {studentCovered ?? 0} bài. Lớp đích không vượt quá mức này.
          </p>
          {eligible.length === 0 ? (
            <p className="rounded-md bg-state-warning-soft px-3 py-2 text-sm text-state-warning-ink">
              Không có lớp phù hợp → tạo yêu cầu sẽ vào danh sách chờ.
            </p>
          ) : (
            <select
              value={toClassId}
              onChange={(e) => setToClassId(e.target.value)}
              className="w-full rounded-md border border-border px-3 py-2 text-sm"
            >
              <option value="">— Chọn lớp đích (để trống = waitlist) —</option>
              {eligible.map((c) => (
                <option key={c.classId} value={c.classId} disabled={c.openSeats <= 0}>
                  {c.name}
                  {c.classCode ? ` (${c.classCode})` : ""} · {c.centerName ?? "—"} · {c.coveredLessons} bài ·{" "}
                  {c.openSeats > 0 ? `còn ${c.openSeats} chỗ` : "hết chỗ"}
                </option>
              ))}
            </select>
          )}
        </div>
      ) : null}

      <label className="text-sm sm:col-span-2">
        <span className="mb-1 block text-muted-foreground">Lý do chuyển</span>
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={2}
          className="w-full rounded-md border border-border px-3 py-2 text-sm"
        />
      </label>

      {eligible ? (
        <div className="sm:col-span-2">
          <button
            onClick={submit}
            disabled={pending}
            className="rounded-md bg-primary-dark px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            Tạo yêu cầu chuyển
          </button>
        </div>
      ) : null}
    </div>
  );
}
