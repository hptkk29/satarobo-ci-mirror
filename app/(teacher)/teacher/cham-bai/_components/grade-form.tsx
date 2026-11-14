// app/(teacher)/teacher/cham-bai/_components/grade-form.tsx — MÀN B (chấm bài).
//
// Visual PORT từ project mock satarobo-ui-giaovien (class-hub.tsx, tab "Bài tập
// & Kiểm tra" — bảng chấm + input điểm) + rubric dialog admin (submission-row.tsx).
// GIỮ NGUYÊN data contract + action THẬT: tái dùng gradeSubmission /
// gradeSubmissionRubric của admin (gate quyền nằm TRONG action — GV chỉ chấm
// lớp mình). shadcn thuần — KHÔNG Magic UI/Framer/Recharts.
//
// 2 chế độ toggle:
//   · "Chấm điểm nhanh": score 0..totalPoints + nhận xét tuỳ chọn → gradeSubmission.
//   · "Chấm rubric": 6 tiêu chí robotics × 4 mức (RUBRIC_CRITERIA/RUBRIC_LEVELS)
//     + nhận xét BẮT BUỘC (≥5 ký tự) → gradeSubmissionRubric (tự quy đổi điểm).
//
// 12/11/2026 — thiết kế lại: hai cột (bài nộp | chấm điểm dính theo cuộn), video/ảnh bấm mở to trong hộp thoại (bai-nop-media.tsx).
//
// Câu 46: props CHỈ chứa tên học viên — KHÔNG SĐT/email/tên PH.
"use client";

import { useState, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import type { RubricCriterion, RubricLevel } from "@prisma/client";
import { Save } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  RUBRIC_CRITERIA,
  RUBRIC_LEVELS,
  rubricToScore,
} from "@/lib/rubric/criteria";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { HelpHint } from "@/components/admin/ui/help-hint";
import {
  gradeSubmission,
  gradeSubmissionRubric,
} from "@/app/(admin)/admin/assignments/_actions";
import { BaiNopMedia, type BaiNopFile } from "./bai-nop-media";

// Màu chip active theo mức rubric — bám tone màu chữ của RUBRIC_LEVELS
// (rose/amber/blue/emerald trong lib/rubric/criteria).
const LEVEL_ACTIVE: Record<RubricLevel, string> = {
  NEED_SUPPORT: "border-state-danger bg-state-danger text-white",
  BASIC: "border-state-warning bg-state-warning text-white",
  GOOD: "border-state-info bg-state-info text-white",
  EXCELLENT: "border-state-success bg-state-success text-white",
};

export type GradeFormProps = {
  submissionId: string;
  studentName: string;
  totalPoints: number;
  /** Đã format vi-VN Asia/Ho_Chi_Minh ở server — tránh lệch timezone client. */
  submittedAtText: string | null;
  isLate: boolean;
  /** Đã chấm rồi (vào từ URL trực tiếp) — cho chấm lại, hiện điểm/nhận xét cũ. */
  graded: boolean;
  textAnswer: string | null;
  fileUrl: string | null;
  fileName: string | null;
  fileSize: number | null;
  /** BGĐ 31/07 — nhiều file/bài nộp; có phần tử → thay thế hiển thị fileUrl đơn cũ. */
  files?: { id: string; url: string; name: string; size: number | null; mime?: string | null }[];
  initialScore: number | null;
  initialFeedback: string | null;
  /** Query suffix (bắt đầu bằng "?") để quay về sau khi chấm xong — GHÉP với pathname
   * hiện tại nên host-safe (/lop vs /teacher/lop). Mặc định (undefined) = về pathname
   * trần (list trang /cham-bai). Class Hub truyền "?classId=…&tab=bai-tap&asgId=…". */
  backHref?: string;
};

export function GradeForm({
  submissionId,
  studentName,
  totalPoints,
  submittedAtText,
  isLate,
  graded,
  textAnswer,
  fileUrl,
  fileName,
  fileSize,
  files,
  initialScore,
  initialFeedback,
  backHref,
}: GradeFormProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();

  const [mode, setMode] = useState<"quick" | "rubric">("quick");
  const [score, setScore] = useState(
    initialScore != null ? String(initialScore) : "",
  );
  // Nhận xét dùng CHUNG 2 chế độ (đổi chế độ không mất chữ đã gõ);
  // chấm nhanh = tuỳ chọn, rubric = bắt buộc ≥5 ký tự (khớp RubricGradeSchema).
  const [feedback, setFeedback] = useState(initialFeedback ?? "");
  const [levels, setLevels] = useState<
    Partial<Record<RubricCriterion, RubricLevel>>
  >({});
  const [sendEmail, setSendEmail] = useState(false);

  // Điểm quy đổi xem trước — cùng công thức rubricToScore action dùng khi lưu.
  const chosen = RUBRIC_CRITERIA.flatMap((c) => {
    const level = levels[c.key];
    return level ? [{ criterion: c.key, level }] : [];
  });
  const previewScore =
    chosen.length === RUBRIC_CRITERIA.length ? rubricToScore(chosen) : null;

  /** Sau khi chấm OK: về list (bỏ query) + refresh để bài biến khỏi "chờ chấm".
   * Trong Class Hub, backHref trỏ về roster chi tiết bài để chấm HV tiếp theo. */
  function backToList() {
    router.replace(backHref ? `${pathname}${backHref}` : pathname);
    router.refresh();
  }

  function submitQuick() {
    const n = Number(score);
    if (score.trim() === "" || Number.isNaN(n)) {
      toast.error("Nhập điểm hợp lệ");
      return;
    }
    if (n < 0 || n > totalPoints) {
      toast.error(`Điểm trong khoảng 0–${totalPoints}`);
      return;
    }
    startTransition(async () => {
      const res = await gradeSubmission({
        submissionId,
        score: n,
        feedback: feedback.trim() || null,
      });
      if (res.ok) {
        toast.success(`Đã chấm ${n}/${totalPoints} cho ${studentName}`);
        backToList();
      } else {
        toast.error(res.error);
      }
    });
  }

  function submitRubric() {
    const missing = RUBRIC_CRITERIA.filter((c) => !levels[c.key]);
    if (missing.length > 0) {
      toast.error(`Chưa chấm: ${missing.map((m) => m.label).join(", ")}`);
      return;
    }
    if (feedback.trim().length < 5) {
      toast.error("Nhận xét là bắt buộc (tối thiểu 5 ký tự)");
      return;
    }
    startTransition(async () => {
      const res = await gradeSubmissionRubric({
        submissionId,
        scores: RUBRIC_CRITERIA.map((c) => ({
          criterion: c.key,
          level: levels[c.key] as RubricLevel,
        })),
        feedback: feedback.trim(),
        sendEmail,
      });
      if (res.ok) {
        toast.success(`Đã chấm rubric cho ${studentName}`);
        backToList();
      } else {
        toast.error(res.error);
      }
    });
  }

  // Bài nộp một-tệp CŨ (cột fileUrl) và bài nhiều tệp đi chung một đường hiển thị.
  const danhSachTep: BaiNopFile[] =
    files && files.length > 0
      ? files
      : fileUrl
        ? [{ id: "tep-cu", url: fileUrl, name: fileName ?? "Tệp đính kèm", size: fileSize, mime: null }]
        : [];
  const khongCoGi = !textAnswer && danhSachTep.length === 0;

  const chu = studentName
    .trim()
    .split(/\s+/)
    .slice(-2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
  // Gợi ý điểm nhanh: 50% · 70% · 80% · 90% · 100% thang điểm (làm tròn 0,5).
  const goiYDiem = Array.from(
    new Set([0.5, 0.7, 0.8, 0.9, 1].map((x) => Math.round(totalPoints * x * 2) / 2)),
  );

  return (
    <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_380px]">
      {/* ── Bài nộp ──────────────────────────────────────────────────────── */}
      <section aria-label="Bài nộp" className="min-w-0 space-y-4">
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-card p-4">
          <span
            aria-hidden="true"
            className="grid size-11 shrink-0 place-items-center rounded-full bg-primary/10 text-sm font-bold text-primary-ink"
          >
            {chu || "HV"}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-base font-bold text-foreground">{studentName}</p>
            <p className="text-sm text-muted-foreground">
              {submittedAtText ? `Nộp lúc ${submittedAtText}` : "Chưa có thời điểm nộp"}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {isLate && (
              <Badge
                variant="outline"
                className="border-state-warning-soft text-state-warning-ink dark:border-state-warning"
              >
                Nộp muộn
              </Badge>
            )}
            {graded ? (
              <Badge
                variant="outline"
                className="border-state-success-soft text-state-success-ink dark:border-state-success"
              >
                Đã chấm{initialScore != null ? ` — ${initialScore}/${totalPoints}` : ""}
              </Badge>
            ) : (
              <Badge variant="outline">Chờ chấm</Badge>
            )}
          </div>
        </div>

        {textAnswer && (
          <blockquote className="rounded-xl border-l-4 border-primary bg-muted/40 px-4 py-3">
            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Lời nhắn của học viên</p>
            <p className="whitespace-pre-wrap text-sm leading-6 text-foreground">{textAnswer}</p>
          </blockquote>
        )}

        <BaiNopMedia files={danhSachTep} />

        {khongCoGi && (
          <p className="rounded-xl border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
            Không có nội dung đính kèm.
          </p>
        )}
      </section>

      {/* ── Chấm điểm (dính theo cuộn ở màn rộng) ─────────────────────────── */}
      <aside aria-label="Chấm điểm" className="lg:sticky lg:top-4">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Chấm điểm</CardTitle>
            {/* Chuyển chế độ — hai nút liền nhau như một ô chọn */}
            <div role="group" aria-label="Cách chấm" className="mt-2 grid grid-cols-2 rounded-lg bg-muted p-1">
              {(
                [
                  { key: "quick", label: "Chấm nhanh" },
                  { key: "rubric", label: "Chấm rubric" },
                ] as const
              ).map((m) => (
                <button
                  key={m.key}
                  type="button"
                  disabled={pending}
                  onClick={() => setMode(m.key)}
                  aria-pressed={mode === m.key}
                  className={cn(
                    "min-h-9 rounded-md px-2.5 text-[13px] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50",
                    mode === m.key ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {m.label}
                </button>
              ))}
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {mode === "quick" ? (
              <div className="space-y-2.5">
                <label className="block text-sm font-medium text-foreground" htmlFor="diem-nhanh">
                  Điểm
                </label>
                <div className="flex items-center gap-2">
                  <Input
                    id="diem-nhanh"
                    type="number"
                    inputMode="decimal"
                    min={0}
                    max={totalPoints}
                    step={0.5}
                    value={score}
                    disabled={pending}
                    onChange={(e) => setScore(e.target.value)}
                    placeholder="0"
                    className="h-12 w-28 text-center text-xl font-bold tabular-nums"
                  />
                  <span className="text-lg font-semibold text-muted-foreground">/ {totalPoints}</span>
                </div>
                <div className="flex flex-wrap gap-1.5" role="group" aria-label="Gợi ý điểm nhanh">
                  {goiYDiem.map((d) => (
                    <button
                      key={d}
                      type="button"
                      disabled={pending}
                      onClick={() => setScore(String(d))}
                      aria-pressed={score === String(d)}
                      className={cn(
                        "min-h-9 min-w-11 rounded-md border px-2.5 text-[13px] font-semibold tabular-nums transition-colors disabled:opacity-50",
                        score === String(d)
                          ? "border-primary bg-primary text-white"
                          : "border-border bg-card text-muted-foreground hover:bg-muted",
                      )}
                    >
                      {d}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                {RUBRIC_CRITERIA.map((c) => (
                  <div key={c.key} className="rounded-lg border border-border p-3">
                    {/* Mô tả tiêu chí gộp vào icon "?" cạnh nhãn: để dạng dòng chữ
                        thì 6 tiêu chí ăn thêm 6 dòng, đẩy bảng rubric dài quá một
                        màn hình — trong khi GV chỉ cần đọc mô tả ở vài lần đầu. */}
                    <p className="mb-2 text-sm font-semibold text-foreground">
                      {c.label}
                      <HelpHint className="ml-1" label={`Tiêu chí ${c.label}`}>
                        {c.desc}
                      </HelpHint>
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {RUBRIC_LEVELS.map((l) => {
                        const active = levels[c.key] === l.key;
                        return (
                          <button
                            key={l.key}
                            type="button"
                            disabled={pending}
                            onClick={() => setLevels((prev) => ({ ...prev, [c.key]: l.key }))}
                            aria-pressed={active}
                            aria-label={`${l.label} — ${c.label}`}
                            className={cn(
                              "min-h-9 rounded-md border px-2.5 text-[13px] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50",
                              active
                                ? LEVEL_ACTIVE[l.key]
                                : "border-border bg-card text-muted-foreground hover:bg-muted",
                            )}
                          >
                            {l.label} ({l.points})
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
                <p className="text-sm text-muted-foreground">
                  Điểm quy đổi:{" "}
                  <span className="font-semibold text-foreground">
                    {previewScore != null ? `${previewScore}/10` : "— (chấm đủ 6 tiêu chí)"}
                  </span>
                </p>
              </div>
            )}

            <label className="block text-sm">
              <span className="mb-1.5 block font-medium text-foreground">
                Nhận xét {mode === "rubric" ? "(bắt buộc)" : "(tuỳ chọn)"}
              </span>
              <Textarea
                rows={4}
                value={feedback}
                disabled={pending}
                onChange={(e) => setFeedback(e.target.value)}
                placeholder="Nhận xét về bài làm của học viên…"
              />
            </label>

            {mode === "rubric" && (
              <label className="flex min-h-9 items-center gap-2 text-sm text-muted-foreground">
                <input
                  type="checkbox"
                  checked={sendEmail}
                  disabled={pending}
                  onChange={(e) => setSendEmail(e.target.checked)}
                />
                Gửi email kết quả cho phụ huynh
              </label>
            )}

            <Button
              onClick={mode === "quick" ? submitQuick : submitRubric}
              disabled={pending}
              className="h-11 w-full"
            >
              <Save className="mr-1.5 h-4 w-4" />
              {pending ? "Đang lưu…" : graded ? "Lưu điểm mới" : "Lưu điểm"}
            </Button>
          </CardContent>
        </Card>
      </aside>
    </div>
  );
}
