"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import {
  REPORT_CARD_STATUS_LABEL,
  type ReportCardMetrics,
  type ReportCardStatusValue,
} from "@/lib/lms/report-card-core";
import { SKILL_LABEL, LEVEL_LABEL as SKILL_LEVEL_LABEL } from "@/lib/lms/skills";
import {
  isMilestonePeriod,
  milestoneLabel,
  REPORT_CARD_MILESTONES,
  milestonePeriodKey,
} from "@/lib/lms/report-card-milestone";
import type { RoboticsSkill, SkillLevel } from "@prisma/client";
import { saveReportCardAction, transitionReportCardAction } from "../_actions";

/** Nhãn tiếng Việt cho khoá kỳ chuẩn (SESSION_5/SESSION_12); period tự do giữ nguyên. */
function periodDisplayLabel(period: string): string | null {
  const m = REPORT_CARD_MILESTONES.find((x) => milestonePeriodKey(x) === period.trim());
  return m ? milestoneLabel(m) : null;
}

const LEVEL_LABEL: Record<number, string> = {
  1: "1 · Cần cố gắng",
  2: "2 · Đạt",
  3: "3 · Khá",
  4: "4 · Tốt",
};

type ScoreState = { criterionId: string; level: number; note: string };
type PeriodState = { period: string; comment: string };

export function ReportCardEditor(props: {
  enrollmentId: string;
  status: ReportCardStatusValue;
  editable: boolean;
  canManage: boolean;
  canReview: boolean;
  publishedAt: string | null;
  metrics: ReportCardMetrics;
  criteria: { id: string; name: string }[];
  finalComment: string;
  completionStatus: string;
  periodComments: PeriodState[];
  scores: ScoreState[];
}) {
  const [pending, startTransition] = useTransition();
  const [finalComment, setFinalComment] = useState(props.finalComment);
  const [completionStatus, setCompletionStatus] = useState(props.completionStatus);
  const [periods, setPeriods] = useState<PeriodState[]>(props.periodComments);
  const [scores, setScores] = useState<ScoreState[]>(props.scores);
  const [reason, setReason] = useState("");

  const { editable, status, canManage, canReview, metrics } = props;
  const att = metrics.attendance;
  // Khoá chưa cấu hình tiêu chí → không lưu/nộp được (server cũng chặn). Vô hiệu nút
  // để không bấm nhầm ra lỗi khó hiểu ("Chưa có học bạ…").
  const hasCriteria = props.criteria.length > 0;

  function setScore(criterionId: string, patch: Partial<ScoreState>) {
    setScores((prev) => prev.map((s) => (s.criterionId === criterionId ? { ...s, ...patch } : s)));
  }

  function save() {
    startTransition(async () => {
      const res = await saveReportCardAction({
        enrollmentId: props.enrollmentId,
        finalComment,
        completionStatus,
        periodComments: periods.filter((p) => p.period || p.comment),
        scores: scores.filter((s) => s.level >= 1 && s.level <= 4).map((s) => ({
          criterionId: s.criterionId,
          level: s.level,
          note: s.note,
        })),
      });
      if (res.ok) toast.success("Đã lưu học bạ");
      else toast.error(res.error);
    });
  }

  function transition(to: ReportCardStatusValue, needReason: boolean) {
    if (needReason && !reason.trim()) {
      toast.error("Cần nhập lý do");
      return;
    }
    startTransition(async () => {
      const res = await transitionReportCardAction({ enrollmentId: props.enrollmentId, to, reason });
      if (res.ok) {
        toast.success("Đã cập nhật trạng thái");
        setReason("");
      } else toast.error(res.error);
    });
  }

  return (
    <div className="space-y-5">
      {/* Status + số liệu động */}
      <div className="flex flex-wrap items-center gap-3">
        <span className="rounded-full bg-muted px-3 py-1 text-sm font-medium text-foreground">
          {REPORT_CARD_STATUS_LABEL[status]}
        </span>
        {props.publishedAt ? (
          <span className="text-xs text-muted-foreground">
            {/* Ghim timeZone VN: client component SSR trên server (UTC) rồi hydrate ở
                trình duyệt (+7) — không ghim sẽ lệch HTML → lỗi hydration (trang trắng). */}
            Phát hành:{" "}
            {new Date(props.publishedAt).toLocaleString("vi-VN", {
              timeZone: "Asia/Ho_Chi_Minh",
            })}
          </span>
        ) : null}
      </div>

      <section className="rounded-xl border border-border bg-card p-4">
        <h2 className="mb-3 text-sm font-semibold text-foreground">Số liệu (tự đổ, live)</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            { label: "Chuyên cần", value: `${att.attended}/${att.total} (${att.rate}%)` },
            { label: "Vắng (chưa bù)", value: att.absent },
            { label: "Đã học bù", value: att.madeUp },
            { label: "Chờ bù", value: att.needMakeup },
            { label: "Bài kiểm tra", value: metrics.exams.count },
            { label: "KT đạt", value: metrics.exams.passed },
            { label: "Điểm TB KT", value: metrics.exams.averageScore ?? "—" },
            ...(metrics.assignments
              ? [
                  {
                    label: "Bài tập (nộp/giao)",
                    value: `${metrics.assignments.submitted}/${metrics.assignments.total}`,
                  },
                  { label: "Bài tập đã chấm", value: metrics.assignments.graded },
                  { label: "Điểm TB bài tập", value: metrics.assignments.averageScore ?? "—" },
                ]
              : []),
          ].map((s) => (
            <div key={s.label} className="rounded-lg border border-border p-3">
              <div className="text-xs text-muted-foreground">{s.label}</div>
              <div className="text-lg font-bold text-foreground">{s.value}</div>
            </div>
          ))}
        </div>
        {metrics.skills && metrics.skills.length > 0 ? (
          <div className="mt-3">
            <h3 className="mb-1 text-xs font-semibold text-muted-foreground">Kỹ năng robot (mới nhất)</h3>
            <ul className="flex flex-wrap gap-2">
              {metrics.skills.map((sk) => (
                <li
                  key={sk.skill}
                  className="rounded-full border border-border px-3 py-1 text-xs text-foreground"
                >
                  {SKILL_LABEL[sk.skill as RoboticsSkill] ?? sk.skill}:{" "}
                  <span className="font-medium">
                    {SKILL_LEVEL_LABEL[sk.level as SkillLevel] ?? sk.level}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        <p className="mt-2 text-xs text-muted-foreground">
          Số liệu được đóng băng vào bản phát hành tại thời điểm phát hành.
        </p>
      </section>

      {/* Nhận xét theo giai đoạn */}
      <section className="rounded-xl border border-border bg-card p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-foreground">Nhận xét theo giai đoạn</h2>
          {editable ? (
            <button
              type="button"
              onClick={() => setPeriods((p) => [...p, { period: "", comment: "" }])}
              className="text-xs font-medium text-primary"
            >
              + Thêm giai đoạn
            </button>
          ) : null}
        </div>
        {periods.length === 0 ? (
          <p className="text-sm text-muted-foreground">Chưa có nhận xét giai đoạn.</p>
        ) : (
          <div className="space-y-2">
            {periods.map((p, i) => (
              <div key={i} className="flex flex-col gap-2 sm:flex-row">
                {/* #17 (câu 55) — kỳ buổi 5 / buổi 12 là mốc cố định: hiện nhãn, khoá tên kỳ,
                    không cho xoá. Giai đoạn tự do cũ vẫn sửa/xoá được như trước. */}
                {periodDisplayLabel(p.period) ? (
                  <span className="flex items-center rounded-md bg-primary-soft px-3 py-2 text-sm font-medium text-primary sm:w-48">
                    {periodDisplayLabel(p.period)}
                  </span>
                ) : (
                  <input
                    value={p.period}
                    disabled={!editable}
                    placeholder="Giai đoạn (vd Giữa khoá)"
                    onChange={(e) =>
                      setPeriods((prev) => prev.map((x, j) => (j === i ? { ...x, period: e.target.value } : x)))
                    }
                    className="rounded-md border border-border px-3 py-2 text-sm sm:w-48"
                  />
                )}
                <input
                  value={p.comment}
                  disabled={!editable}
                  placeholder="Nhận xét"
                  onChange={(e) =>
                    setPeriods((prev) => prev.map((x, j) => (j === i ? { ...x, comment: e.target.value } : x)))
                  }
                  className="flex-1 rounded-md border border-border px-3 py-2 text-sm"
                />
                {editable && !isMilestonePeriod(p.period) ? (
                  <button
                    type="button"
                    onClick={() => setPeriods((prev) => prev.filter((_, j) => j !== i))}
                    className="text-xs text-state-danger-ink"
                  >
                    Xoá
                  </button>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Chấm năng lực theo tiêu chí */}
      <section className="rounded-xl border border-border bg-card p-4">
        <h2 className="mb-3 text-sm font-semibold text-foreground">Đánh giá năng lực (thang 1–4)</h2>
        {props.criteria.length === 0 ? (
          <p className="text-sm text-muted-foreground">Khoá chưa có tiêu chí.</p>
        ) : (
          <div className="space-y-2">
            {props.criteria.map((c) => {
              const sc = scores.find((s) => s.criterionId === c.id);
              return (
                <div key={c.id} className="flex flex-col gap-2 sm:flex-row sm:items-center">
                  <div className="sm:w-56 text-sm font-medium text-foreground">{c.name}</div>
                  <select
                    value={sc?.level ?? 0}
                    disabled={!editable}
                    onChange={(e) => setScore(c.id, { level: Number(e.target.value) })}
                    className="rounded-md border border-border px-3 py-2 text-sm sm:w-44"
                  >
                    <option value={0}>— Chưa chấm —</option>
                    {[1, 2, 3, 4].map((lv) => (
                      <option key={lv} value={lv}>
                        {LEVEL_LABEL[lv]}
                      </option>
                    ))}
                  </select>
                  <input
                    value={sc?.note ?? ""}
                    disabled={!editable}
                    placeholder="Ghi chú (tuỳ chọn)"
                    onChange={(e) => setScore(c.id, { note: e.target.value })}
                    className="flex-1 rounded-md border border-border px-3 py-2 text-sm"
                  />
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Nhận xét tổng kết */}
      <section className="rounded-xl border border-border bg-card p-4">
        <h2 className="mb-3 text-sm font-semibold text-foreground">Tổng kết</h2>
        <label className="mb-1 block text-xs text-muted-foreground">Kết quả hoàn thành</label>
        <input
          value={completionStatus}
          disabled={!editable}
          placeholder="vd Hoàn thành tốt"
          onChange={(e) => setCompletionStatus(e.target.value)}
          className="mb-3 w-full rounded-md border border-border px-3 py-2 text-sm sm:w-72"
        />
        <label className="mb-1 block text-xs text-muted-foreground">Nhận xét tổng kết</label>
        <textarea
          value={finalComment}
          disabled={!editable}
          rows={4}
          onChange={(e) => setFinalComment(e.target.value)}
          className="w-full rounded-md border border-border px-3 py-2 text-sm"
        />
      </section>

      {/* Lý do (cho trả lại / thu hồi) */}
      {canReview && (status === "PENDING_REVIEW" || status === "PUBLISHED") ? (
        <div>
          <label className="mb-1 block text-xs text-muted-foreground">Lý do (bắt buộc khi trả lại / thu hồi)</label>
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className="w-full rounded-md border border-border px-3 py-2 text-sm"
          />
        </div>
      ) : null}

      {/* Hành động */}
      {editable && !hasCriteria ? (
        <p className="text-sm text-state-warning-ink">
          Cần cấu hình tiêu chí năng lực cho khoá trước khi lưu / nộp học bạ.
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {editable ? (
          <button
            type="button"
            disabled={pending || !hasCriteria}
            onClick={save}
            className="rounded-md bg-neutral-800 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            Lưu nháp
          </button>
        ) : null}

        {canManage && (status === "DRAFT" || status === "RECALLED") ? (
          <button
            type="button"
            disabled={pending || !hasCriteria}
            onClick={() => transition("PENDING_REVIEW", false)}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary-dark disabled:opacity-50"
          >
            {status === "RECALLED" ? "Nộp lại để duyệt" : "Nộp duyệt"}
          </button>
        ) : null}

        {canReview && status === "PENDING_REVIEW" ? (
          <>
            <button
              type="button"
              disabled={pending}
              onClick={() => transition("PUBLISHED", false)}
              className="rounded-md bg-state-success-ink px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              Phát hành
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => transition("DRAFT", true)}
              className="rounded-md border border-border px-4 py-2 text-sm font-medium text-foreground disabled:opacity-50"
            >
              Trả lại (nháp)
            </button>
          </>
        ) : null}

        {canReview && status === "PUBLISHED" ? (
          <button
            type="button"
            disabled={pending}
            onClick={() => transition("RECALLED", true)}
            className="rounded-md bg-state-danger-ink px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            Thu hồi
          </button>
        ) : null}
      </div>
    </div>
  );
}
