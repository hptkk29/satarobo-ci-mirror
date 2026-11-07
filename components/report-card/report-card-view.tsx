import {
  reportCardPeriodDisplay,
  type PublishedReportCardView,
} from "@/lib/lms/report-card";
import {
  SKILL_LABEL,
  LEVEL_LABEL as SKILL_LEVEL_LABEL,
} from "@/lib/lms/skills";
import type { RoboticsSkill, SkillLevel } from "@prisma/client";

const LEVEL_LABEL: Record<number, string> = {
  1: "Cần cố gắng",
  2: "Đạt",
  3: "Khá",
  4: "Tốt",
};

// Presentational học bạ ĐÃ PHÁT HÀNH (đọc từ snapshot). Server component.
export function ReportCardView({ card }: { card: PublishedReportCardView }) {
  const att = card.metrics.attendance;
  const assignments = card.metrics.assignments;
  const skills = card.metrics.skills;
  return (
    <section className="space-y-4 rounded-xl border border-neutral-200 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-lg font-bold text-neutral-900">
            Học bạ — {card.course.name}
          </h2>
          <p className="text-sm text-neutral-500">
            {card.className}
            {card.publishedAt
              ? ` · Phát hành ${card.publishedAt.slice(0, 10)}`
              : ""}
          </p>
        </div>
        <a
          href={`/api/portal/report-card/${card.id}`}
          target="_blank"
          rel="noopener"
          className="rounded-md bg-purple-700 px-4 py-2 text-sm font-medium text-white"
        >
          Tải PDF
        </a>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          {
            label: "Chuyên cần",
            value: `${att.attended}/${att.total} (${att.rate}%)`,
          },
          { label: "Đã học bù", value: att.madeUp },
          {
            label: "Bài kiểm tra",
            value: `${card.metrics.exams.passed}/${card.metrics.exams.count}`,
          },
          {
            label: "Điểm TB KT",
            value: card.metrics.exams.averageScore ?? "—",
          },
          ...(assignments
            ? [
                {
                  label: "Bài tập (nộp/giao)",
                  value: `${assignments.submitted}/${assignments.total}`,
                },
                {
                  label: "Điểm TB bài tập",
                  value: assignments.averageScore ?? "—",
                },
              ]
            : []),
        ].map((s) => (
          <div
            key={s.label}
            className="rounded-lg border border-neutral-200 p-3"
          >
            <div className="text-xs text-neutral-500">{s.label}</div>
            <div className="text-lg font-bold text-neutral-900">{s.value}</div>
          </div>
        ))}
      </div>

      {skills && skills.length > 0 ? (
        <div>
          <h3 className="mb-1 text-sm font-semibold text-neutral-700">
            Kỹ năng robot
          </h3>
          <ul className="flex flex-wrap gap-2">
            {skills.map((sk) => (
              <li
                key={sk.skill}
                className="rounded-full border border-neutral-200 px-3 py-1 text-xs text-neutral-700"
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

      {card.scores.length > 0 ? (
        <div>
          <h3 className="mb-1 text-sm font-semibold text-neutral-700">
            Đánh giá năng lực
          </h3>
          <ul className="divide-y text-sm">
            {card.scores.map((s) => (
              <li
                key={s.criterionId}
                className="flex items-center justify-between py-1.5"
              >
                <span>{s.name}</span>
                <span className="text-neutral-500">
                  {LEVEL_LABEL[s.level] ?? s.level}
                  {s.note ? ` · ${s.note}` : ""}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {card.periodComments.length > 0 ? (
        <div>
          <h3 className="mb-1 text-sm font-semibold text-neutral-700">
            Nhận xét theo giai đoạn
          </h3>
          <ul className="space-y-1 text-sm">
            {card.periodComments.map((p, i) => (
              <li key={i}>
                {/* A1: PH không được thấy mã kỹ thuật SESSION_5/SESSION_12 — map ra nhãn VN. */}
                <span className="font-medium">
                  {reportCardPeriodDisplay(p.period)}:{" "}
                </span>
                <span className="text-neutral-600">{p.comment}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {card.completionStatus ? (
        <p className="text-sm">
          <span className="font-semibold text-neutral-700">Kết quả: </span>
          {card.completionStatus}
        </p>
      ) : null}

      {card.finalComment ? (
        <div>
          <h3 className="mb-1 text-sm font-semibold text-neutral-700">
            Nhận xét tổng kết
          </h3>
          <p className="text-sm text-neutral-600">{card.finalComment}</p>
        </div>
      ) : null}
    </section>
  );
}
