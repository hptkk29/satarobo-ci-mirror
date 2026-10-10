"use client";

import { useState } from "react";
import {
  ListChecks,
  Target,
  BookOpen,
  ClipboardCheck,
  CircleCheck,
} from "lucide-react";
import type {
  StudentSessionsView,
  StudentSessionItem,
  SessionAttendance,
} from "@/lib/portal/student-sessions";

const ATT: Record<SessionAttendance, { label: string; cls: string }> = {
  PRESENT: { label: "Có mặt", cls: "bg-success/10 text-success" },
  EXCUSED: { label: "Vắng có phép", cls: "bg-caution/10 text-caution" },
  ABSENT: { label: "Vắng", cls: "bg-destructive/10 text-destructive" },
  MAKEUP: { label: "Học bù", cls: "bg-info/10 text-info" },
  FUTURE: { label: "Chưa diễn ra", cls: "bg-muted text-muted-foreground" },
  // Buổi đã qua mà giáo viên chưa chấm — nói thật, đừng in "Có mặt" (bản cũ làm vậy).
  UNMARKED: { label: "Chưa điểm danh", cls: "bg-muted text-muted-foreground" },
  CANCELLED: { label: "Đã huỷ", cls: "bg-destructive/10 text-destructive" },
};

// 06/09 — nhãn ngày do SERVER tính theo lịch VN (`item.nhanNgay`); component không tự
// `new Date(...).getDate()` nữa. Thiết bị của phụ huynh có thể ở múi giờ khác, và ô
// "Hạn" của bài tập không đặt hạn từng in ra "NaN/NaN/NaN" vì `new Date("")`.

export function StudentBuoiHocPage({ data }: { data: StudentSessionsView }) {
  const initial =
    data.sessions.find((s) => s.today) ??
    data.sessions.filter((s) => s.past).slice(-1)[0] ??
    data.sessions[0] ??
    null;
  const [selId, setSelId] = useState<string | null>(initial?.id ?? null);
  const sel = data.sessions.find((s) => s.id === selId) ?? initial;

  return (
    <div className="portal-v2 mx-auto w-full max-w-6xl space-y-6">
      {/* Hero cam */}
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-primary to-primary/80 p-5 text-white sm:p-6">
        <ListChecks className="pointer-events-none absolute -right-3 -top-3 size-28 rotate-12 text-white/10" />
        <div className="relative flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-center gap-4">
            <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-white/15 ring-4 ring-white/10">
              <ListChecks className="size-6" />
            </span>
            <div className="min-w-0">
              <h1 className="text-xl font-bold tracking-tight sm:text-2xl">
                Buổi học của em
              </h1>
              <p className="mt-0.5 truncate text-xs font-medium text-white/80 sm:text-sm">
                Mục tiêu, điểm danh và bài tập từng buổi ·{" "}
                {data.courseName ?? "Khóa học"}
              </p>
            </div>
          </div>
          {/* 06/09 — nhãn nói rõ MẪU SỐ của từng con số. Trước đây ô đầu ghi "Đã học
              10/12" trong khi ô cạnh ghi "Có mặt 6": hai con số cùng chữ "học" mà khác
              nghĩa (10 = buổi lớp ĐÃ DẠY, 6 = buổi con CÓ MẶT), nên phụ huynh đọc ra là
              hệ thống mâu thuẫn. Ô "Chưa chấm" bù đúng phần chênh còn lại. */}
          <div className="grid grid-cols-4 gap-2">
            <Metric value={`${data.done}/${data.total}`} label="Buổi đã dạy" />
            <Metric value={String(data.present)} label="Con có mặt" />
            <Metric value={String(data.absent)} label="Vắng" />
            {data.chuaCham > 0 ? (
              <Metric value={String(data.chuaCham)} label="Chưa chấm" />
            ) : (
              <Metric value={String(data.makeup)} label="Đã học bù" />
            )}
          </div>
        </div>
      </div>

      {data.sessions.length === 0 ? (
        <div className="rounded-2xl border border-border bg-card p-10 text-center text-sm text-muted-foreground">
          Chưa có buổi học nào.
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[20rem_1fr]">
          {/* Danh sách buổi */}
          <div className="max-h-[32rem] space-y-2 overflow-y-auto rounded-2xl border border-border bg-card p-2">
            {data.sessions.map((s) => {
              const active = s.id === sel?.id;
              const badge = ATT[s.attendance];
              return (
                <button
                  key={s.id}
                  onClick={() => setSelId(s.id)}
                  className={`flex w-full items-center gap-2.5 rounded-xl border p-2.5 text-left transition-colors ${active ? "border-primary/40 bg-primary/5" : "border-transparent hover:bg-muted"}`}
                >
                  <span
                    className={`grid size-8 shrink-0 place-items-center rounded-lg text-xs font-bold ${s.past ? "bg-success/15 text-success" : "bg-muted text-muted-foreground"}`}
                  >
                    {s.past && s.attendance !== "CANCELLED" ? (
                      <CircleCheck className="size-4" />
                    ) : (
                      s.order
                    )}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-bold text-foreground">
                      {s.nhan}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {[s.nhanNgay, s.className && `Lớp ${s.className}`]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  </span>
                  <span
                    className={`shrink-0 rounded-md px-2 py-0.5 text-[11px] font-bold ${badge.cls}`}
                  >
                    {s.today ? "Hôm nay" : badge.label}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Chi tiết buổi */}
          {sel && <Detail s={sel} />}
        </div>
      )}
    </div>
  );
}

function Detail({ s }: { s: StudentSessionItem }) {
  const badge = ATT[s.attendance];
  return (
    <div className="space-y-5 rounded-2xl border border-border bg-card p-5">
      <div className="flex flex-wrap items-start justify-between gap-2 border-b border-border pb-4">
        <div>
          <h2 className="text-lg font-bold text-foreground">{s.nhan}</h2>
          <p className="mt-0.5 text-xs font-medium text-muted-foreground">
            📅 {[s.nhanNgay, s.className && `Lớp ${s.className}`]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>
        <span
          className={`shrink-0 rounded-md px-2.5 py-1 text-xs font-bold ${s.today ? "bg-primary/10 text-primary" : badge.cls}`}
        >
          {s.today ? "Hôm nay" : badge.label}
        </span>
      </div>

      <div>
        <h3 className="mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">
          <Target className="size-4 text-primary" /> Mục tiêu buổi học
        </h3>
        {s.objectives.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Chưa cập nhật mục tiêu.
          </p>
        ) : (
          <ul className="space-y-1.5">
            {s.objectives.map((o, i) => (
              <li key={i} className="flex gap-2 text-sm text-foreground">
                <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-primary" />{" "}
                {o}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div>
        <h3 className="mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">
          <BookOpen className="size-4 text-primary" /> Bài tập của buổi
        </h3>
        {!s.assignment ? (
          <p className="text-sm text-muted-foreground">
            Buổi này không có bài tập.
          </p>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border bg-muted/30 p-3">
            <div>
              <p className="text-sm font-bold text-foreground">
                {s.assignment.title}
              </p>
              {s.assignment.nhanHan && (
                <p className="text-xs text-muted-foreground">
                  Hạn: {s.assignment.nhanHan}
                </p>
              )}
            </div>
            {s.assignment.done ? (
              <a
                href={`/portal/bai-tap/${s.assignment.id}`}
                className="rounded-md bg-success/10 px-2 py-1 text-xs font-bold text-success hover:bg-success/20"
              >
                Đã làm · Xem
              </a>
            ) : (
              <a
                href={`/portal/bai-tap/${s.assignment.id}`}
                className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-3.5 py-2 text-sm font-bold text-primary-foreground transition-opacity hover:opacity-90"
              >
                Làm bài
              </a>
            )}
          </div>
        )}
      </div>

      <div>
        <h3 className="mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">
          <ClipboardCheck className="size-4 text-primary" /> Điểm danh
        </h3>
        <span
          className={`inline-block rounded-md px-2.5 py-1 text-sm font-bold ${s.today ? "bg-primary/10 text-primary" : badge.cls}`}
        >
          {s.today ? "Hôm nay" : badge.label}
        </span>
      </div>
    </div>
  );
}

function Metric({ value, label }: { value: string; label: string }) {
  return (
    <span className="rounded-xl bg-white/15 px-2.5 py-2 text-center backdrop-blur-sm">
      <span className="block text-base font-bold tabular-nums">{value}</span>
      <span className="text-[10px] font-bold text-white/80">{label}</span>
    </span>
  );
}
