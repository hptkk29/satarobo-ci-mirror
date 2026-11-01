"use client";

import { useMemo, useState } from "react";
import { displayProjectName } from "@/lib/lms/session-project-name";
import {
  MessageSquareText,
  Search,
  Calendar,
  User,
  School,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { FeedbackItem } from "@/lib/portal/feedback";
import {
  EVAL_OVERALL_LABEL,
  evalLevelText,
  evalNotesProse,
  groupedEvalCriteria,
  type EvalNotes,
} from "@/lib/lms/session-eval-rubric";
import { PageHero } from "@/components/portal/page-header";
import { ChildSwitcher } from "@/components/portal/child-switcher";

const GROUPS = groupedEvalCriteria();

function fmt(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
}

// Nhận xét: comment lưu dạng nhiều dòng "Nhãn: nội dung" → render nhãn cam.
function CommentBody({ text }: { text: string }) {
  const lines = text.split("\n").filter((l) => l.trim());
  if (lines.length === 0) return null;
  const [head, ...rest] = lines;
  return (
    <div className="rounded-xl bg-muted/40 p-4 space-y-2">
      <p className="text-sm font-bold text-foreground">{head}</p>
      {rest.map((l, i) => {
        const m = l.match(/^([^:]+):\s*(.*)$/);
        return (
          <p key={i} className="text-sm leading-relaxed text-muted-foreground">
            {m ? (
              <>
                <span className="font-bold text-primary">{m[1]}:</span> {m[2]}
              </>
            ) : (
              l
            )}
          </p>
        );
      })}
    </div>
  );
}

// Phiếu mở rộng. Từ 21/08 có HAI dạng cùng tồn tại (evalNotesProse):
//   • phiếu mới — một đoạn "Đánh giá chung";
//   • phiếu cũ  — 4 mục Kiến thức/Kỹ năng/Thái độ/Đề xuất, nhãn cam, bỏ mục trống.
function NotesBody({ notes }: { notes: EvalNotes }) {
  const prose = evalNotesProse(notes);
  if (!prose) return null;
  if (prose.kind === "overall") {
    return (
      <div className="rounded-xl bg-muted/40 p-4 space-y-2">
        <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
          {EVAL_OVERALL_LABEL}
        </p>
        <p className="whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground">
          {prose.text}
        </p>
      </div>
    );
  }
  return (
    <div className="rounded-xl bg-muted/40 p-4 space-y-2">
      {prose.rows.map((r) => (
        <p
          key={r.key}
          className="text-sm leading-relaxed text-muted-foreground"
        >
          <span className="font-bold text-primary">{r.label}:</span> {r.text}
        </p>
      ))}
    </div>
  );
}

// Phiếu mở rộng: rubric năng lực theo nhóm — chỉ render tiêu chí phiếu có chấm.
function RubricBody({ rubric }: { rubric: Record<string, number> }) {
  return (
    <div className="space-y-3">
      {GROUPS.map(([group, items]) => {
        const rows = items.filter((c) => rubric[c.id] != null);
        if (rows.length === 0) return null;
        return (
          <div key={group} className="rounded-xl bg-muted/40 p-4">
            <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
              {group}
            </p>
            <div className="mt-2 space-y-2">
              {rows.map((c) => (
                <div key={c.id}>
                  <p className="text-sm font-bold text-foreground">{c.name}</p>
                  <p className="text-sm leading-relaxed text-muted-foreground">
                    {evalLevelText(c.id, rubric[c.id]) ||
                      `Mức ${rubric[c.id]}/5`}
                  </p>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// Sao đánh giá chung (đường cũ /teacher/nhan-xet) — clamp 0-5 phòng data lệch.
function RatingStars({ rating }: { rating: number }) {
  const r = Math.min(5, Math.max(0, Math.trunc(rating)));
  return (
    <p className="text-sm text-amber-500" aria-label={`Đánh giá ${r}/5 sao`}>
      {"★".repeat(r)}
      {"☆".repeat(5 - r)}
    </p>
  );
}

/**
 * Phiếu SESSION_EVAL (module Đánh giá dựng form) đã rút gọn thành dạng serialize được.
 *
 * 06/09 — bản v2 trước đây KHÔNG hiển thị nhóm phiếu này, trong khi bản v1 có. Trung
 * tâm nào dùng module `/admin/evaluations` để chấm buổi thì phụ huynh mất hẳn phần đó
 * kể từ ngày prod bật `PORTAL_V2_ENABLED`.
 */
export type PhieuDanhGiaBuoi = {
  responseId: string;
  tieuDe: string;
  nhanNgay: string;
  teacherName: string | null;
  sessionTopic: string | null;
  answers: {
    questionId: string;
    label: string;
    stars: number | null;
    options: string[] | null;
    text: string | null;
  }[];
};

export function NhanXetPageV2({
  kids,
  activeId,
  studentName,
  items,
  phieuDanhGia = [],
}: {
  kids: { id: string; name: string }[];
  activeId: string | null;
  studentName: string;
  items: FeedbackItem[];
  phieuDanhGia?: PhieuDanhGiaBuoi[];
}) {
  const [selId, setSelId] = useState(items[0]?.id ?? "");
  const [q, setQ] = useState("");
  const [range, setRange] = useState("all"); // all | 7 | 30 | 90 (ngày)
  const [teacher, setTeacher] = useState("all");
  const [klass, setKlass] = useState("all");

  const teachers = useMemo(
    () => [
      ...new Set(items.map((it) => it.teacher).filter((t): t is string => !!t)),
    ],
    [items],
  );
  const classes = useMemo(
    () => [
      ...new Set(
        items.map((it) => it.className).filter((c): c is string => !!c),
      ),
    ],
    [items],
  );

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const minTime =
      range === "all" ? null : Date.now() - Number(range) * 24 * 60 * 60 * 1000;
    return items.filter((it) => {
      if (needle) {
        const notesText = it.notes ? Object.values(it.notes).join("\n") : "";
        const hay =
          `${it.title}\n${it.comment}\n${it.projectName ?? ""}\n${notesText}`.toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      if (minTime !== null && new Date(it.dateISO).getTime() < minTime)
        return false;
      if (teacher !== "all" && it.teacher !== teacher) return false;
      if (klass !== "all" && it.className !== klass) return false;
      return true;
    });
  }, [items, q, range, teacher, klass]);

  // Mục đang chọn phải nằm trong danh sách sau lọc — nếu bị lọc mất, lấy mục đầu.
  const sel = shown.find((it) => it.id === selId) ?? shown[0] ?? null;
  const selectCls =
    "rounded-xl border border-border bg-card px-3 py-2 text-sm text-foreground outline-none focus:border-primary/40";

  return (
    <div className="portal-v2 mx-auto w-full max-w-6xl space-y-6">
      <ChildSwitcher kids={kids} activeId={activeId} />

      <PageHero
        icon={MessageSquareText}
        title="Nhận xét theo buổi học"
        subtitle={`Nhận xét chi tiết của giáo viên dành cho ${studentName} · ${items.length} nhận xét`}
      />

      {/* Search + filters */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Tìm tên bài học / nội dung nhận xét..."
            className="w-full rounded-xl border border-border bg-card py-2 pl-9 pr-3 text-sm outline-none focus:border-primary/40"
          />
        </div>
        <select
          value={range}
          onChange={(e) => setRange(e.target.value)}
          className={selectCls}
          aria-label="Lọc theo thời gian"
        >
          <option value="all">Mọi lúc</option>
          <option value="7">7 ngày qua</option>
          <option value="30">30 ngày qua</option>
          <option value="90">90 ngày qua</option>
        </select>
        <select
          value={teacher}
          onChange={(e) => setTeacher(e.target.value)}
          className={selectCls}
          aria-label="Lọc theo giáo viên"
        >
          <option value="all">Mọi GV</option>
          {teachers.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <select
          value={klass}
          onChange={(e) => setKlass(e.target.value)}
          className={selectCls}
          aria-label="Lọc theo lớp"
        >
          <option value="all">Tất cả lớp</option>
          {classes.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </div>

      {items.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-card p-8 text-center text-sm text-muted-foreground">
          Chưa có nhận xét nào.
        </div>
      ) : shown.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-card p-8 text-center text-sm text-muted-foreground">
          Không có nhận xét khớp bộ lọc — thử đổi từ khóa hoặc bộ lọc.
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,20rem)_1fr]">
          {/* List */}
          <div className="space-y-2">
            {shown.map((it) => {
              const active = it.id === sel?.id;
              return (
                <button
                  key={it.id}
                  onClick={() => setSelId(it.id)}
                  className={cn(
                    "flex w-full items-start gap-3 rounded-2xl border p-3 text-left transition-colors",
                    active
                      ? "border-primary/40 bg-primary/5"
                      : "border-border bg-card hover:bg-muted",
                  )}
                >
                  <span
                    className={cn(
                      "grid size-8 shrink-0 place-items-center rounded-lg text-sm font-bold",
                      active
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted text-muted-foreground",
                    )}
                  >
                    {it.order ?? "•"}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-bold text-foreground">
                      {it.title.replace(/^Buổi \d+: /, "")}
                    </p>
                    <p className="mt-0.5 truncate text-xs font-medium text-muted-foreground">
                      {fmt(it.dateISO)}
                      {it.teacher ? ` · ${it.teacher}` : ""}
                    </p>
                  </div>
                </button>
              );
            })}
          </div>

          {/* Detail */}
          {sel && (
            <div className="space-y-4 rounded-2xl border border-border bg-card p-4">
              <div className="-m-4 mb-0 rounded-t-2xl bg-gradient-to-br from-accent to-accent/80 p-4 text-white">
                <p className="text-xs font-bold uppercase tracking-wider text-white/70">
                  Báo cáo buổi học
                </p>
                <p className="text-base font-bold">{sel.title}</p>
                <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-white/90">
                  <span className="inline-flex items-center gap-1">
                    <Calendar className="size-3.5" /> {fmt(sel.dateISO)}
                  </span>
                  {sel.teacher && (
                    <span className="inline-flex items-center gap-1">
                      <User className="size-3.5" /> {sel.teacher}
                    </span>
                  )}
                  {sel.className && (
                    <span className="inline-flex items-center gap-1">
                      <School className="size-3.5" /> Lớp: {sel.className}
                    </span>
                  )}
                </div>
              </div>

              {sel.projectName && (
                <p className="pt-2 text-sm text-muted-foreground">
                  <span className="font-bold text-foreground">Dự án:</span>{" "}
                  {displayProjectName(sel.projectName)}
                </p>
              )}

              {/* ① Văn xuôi: phiếu mở rộng ưu tiên 4 mục notes (có nhãn); comment cũ là
                  fallback (phiếu mới lưu comment = notes nối lại, render cả 2 sẽ lặp). */}
              <div className="space-y-3 pt-2">
                <h3 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-foreground">
                  <span className="grid size-6 place-items-center rounded-md bg-primary/10 text-primary">
                    1
                  </span>
                  Nhận xét của giáo viên
                </h3>
                {sel.rating != null && <RatingStars rating={sel.rating} />}
                {sel.notes ? (
                  <NotesBody notes={sel.notes} />
                ) : sel.comment.trim() ? (
                  <CommentBody text={sel.comment} />
                ) : (
                  <p className="rounded-xl bg-muted/40 p-4 text-sm text-muted-foreground">
                    {sel.rubric
                      ? "Buổi này giáo viên đánh giá qua bảng năng lực bên dưới."
                      : "Chưa có nội dung nhận xét chi tiết cho buổi này."}
                  </p>
                )}
              </div>

              {/* ② Rubric năng lực (phiếu mở rộng — lib/lms/session-eval-rubric) */}
              {sel.rubric && (
                <div className="space-y-3">
                  <h3 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-foreground">
                    <span className="grid size-6 place-items-center rounded-md bg-primary/10 text-primary">
                      2
                    </span>
                    Đánh giá chi tiết năng lực
                  </h3>
                  <RubricBody rubric={sel.rubric} />
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Phiếu đánh giá buổi học từ module Đánh giá (SESSION_EVAL) — parity với bản v1.
          Chỉ hiện khi trung tâm thực sự dùng module đó; im lặng khi không có. */}
      {phieuDanhGia.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-bold uppercase tracking-wider text-foreground">
            Phiếu đánh giá buổi học
          </h2>
          <div className="space-y-3">
            {phieuDanhGia.map((ev) => (
              <div
                key={ev.responseId}
                className="rounded-2xl border border-border bg-card p-4"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-bold text-foreground">{ev.tieuDe}</p>
                  <span className="text-xs tabular-nums text-muted-foreground">
                    {ev.nhanNgay}
                  </span>
                </div>
                <p className="mt-0.5 text-xs font-medium text-muted-foreground">
                  {[
                    ev.teacherName && `GV ${ev.teacherName}`,
                    ev.sessionTopic,
                  ]
                    .filter(Boolean)
                    .join(" · ") || "—"}
                </p>
                {ev.answers.length === 0 ? (
                  <p className="mt-2 text-sm text-muted-foreground">
                    Phiếu chưa có nội dung.
                  </p>
                ) : (
                  <dl className="mt-3 space-y-2">
                    {ev.answers.map((a) => (
                      <div key={a.questionId}>
                        <dt className="text-xs font-semibold text-muted-foreground">
                          {a.label}
                        </dt>
                        <dd className="text-sm text-foreground">
                          {a.stars != null ? (
                            <RatingStars rating={a.stars} />
                          ) : (
                            [a.options?.join(", "), a.text]
                              .filter(Boolean)
                              .join(" · ") || "—"
                          )}
                        </dd>
                      </div>
                    ))}
                  </dl>
                )}
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
