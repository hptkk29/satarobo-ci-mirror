import type { StudentTranscript } from "@/lib/transcript/service";
import type { RoboticsSkill, SkillLevel } from "@prisma/client";
import { SKILL_LABEL, LEVEL_LABEL } from "@/lib/lms/skills";
import { ENROLLMENT_STATUS } from "@/lib/labels/registry";
import { PhanTrangBang } from "@/components/ui/phan-trang-bang";

// Presentational học bạ (server component, dùng chung portal + admin).
export function TranscriptView({
  t,
  pdfHref,
}: {
  t: StudentTranscript;
  pdfHref: string;
}) {
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-bold text-neutral-900">
            Học bạ — {t.student.name}
          </h1>
          <p className="text-sm text-neutral-500">
            {t.student.studentCode ? `Mã ${t.student.studentCode}` : ""}
            {t.student.currentGrade ? ` · Lớp ${t.student.currentGrade}` : ""}
            {t.student.school ? ` · ${t.student.school}` : ""}
          </p>
        </div>
        <a
          href={pdfHref}
          target="_blank"
          rel="noopener"
          className="rounded-md bg-purple-700 px-4 py-2 text-sm font-medium text-white"
        >
          Tải PDF
        </a>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label: "Số lớp", value: t.summary.totalClasses },
          { label: "Khoá hoàn thành", value: t.summary.completedCourses },
          { label: "Chuyên cần", value: `${t.summary.overallAttendanceRate}%` },
          { label: "Điểm TB", value: t.summary.overallAverageScore ?? "—" },
        ].map((s) => (
          <div
            key={s.label}
            className="rounded-xl border border-neutral-200 bg-white p-3"
          >
            <div className="text-xs text-neutral-500">{s.label}</div>
            <div className="text-lg font-bold text-neutral-900">{s.value}</div>
          </div>
        ))}
      </div>

      <section className="rounded-xl border border-neutral-200 bg-white">
        <div className="border-b px-4 py-2 text-sm font-semibold text-neutral-700">
          Quá trình học theo lớp
        </div>
        {/* Giữ phân trang của nhánh này + lấy màu neutral-500 của nhánh test (sửa tương
            phản a11y) — hai thay đổi độc lập, không cái nào phải nhường cái nào. */}
        <PhanTrangBang cuonNgang tenDonVi="lớp">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-neutral-500">
              <tr>
                <th className="px-4 py-2">Lớp</th>
                <th className="px-4 py-2">Khoá</th>
                <th className="px-4 py-2 text-center">Chuyên cần</th>
                <th className="px-4 py-2 text-center">Điểm TB</th>
                <th className="px-4 py-2 text-center">Trạng thái</th>
              </tr>
            </thead>
            <tbody>
              {t.classes.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-center text-neutral-500">
                    Chưa có lớp.
                  </td>
                </tr>
              ) : (
                t.classes.map((c) => (
                  <tr key={c.classId} className="border-t">
                    <td className="px-4 py-2 font-medium">{c.className}</td>
                    <td className="px-4 py-2">{c.courseName}</td>
                    <td className="px-4 py-2 text-center">
                      {c.totalSessions === 0
                        ? "Chưa diễn ra"
                        : `${c.attendedSessions}/${c.totalSessions} (${c.attendanceRate}%)`}
                    </td>
                    <td className="px-4 py-2 text-center">{c.averageScore ?? "—"}</td>
                    <td className="px-4 py-2 text-center text-neutral-500">
                      {ENROLLMENT_STATUS.label(c.status)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </PhanTrangBang>
      </section>

      {t.completions.length > 0 ? (
        <section className="rounded-xl border border-neutral-200 bg-white">
          <div className="border-b px-4 py-2 text-sm font-semibold text-neutral-700">
            Khoá đã hoàn thành
          </div>
          <ul className="divide-y text-sm">
            {t.completions.map((c, i) => (
              <li
                key={i}
                className="flex items-center justify-between px-4 py-2"
              >
                <span className="font-medium">{c.courseName}</span>
                <span className="text-neutral-500">
                  {c.completedAt.toISOString().slice(0, 10)}
                  {c.finalGrade ? ` · ${c.finalGrade}` : ""} ·{" "}
                  {c.certificateCode}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {t.skills.length > 0 ? (
        <section className="rounded-xl border border-neutral-200 bg-white">
          <div className="border-b px-4 py-2 text-sm font-semibold text-neutral-700">
            Đánh giá năng lực
          </div>
          <ul className="divide-y text-sm">
            {t.skills.map((s, i) => (
              <li
                key={i}
                className="flex items-center justify-between px-4 py-2"
              >
                <span>{SKILL_LABEL[s.skill as RoboticsSkill] ?? s.skill}</span>
                <span className="text-neutral-500">
                  {LEVEL_LABEL[s.level as SkillLevel] ?? s.level} ·{" "}
                  {s.assessedAt.toISOString().slice(0, 10)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
