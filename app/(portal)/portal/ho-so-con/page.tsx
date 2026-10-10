import { requireActiveStudent } from "@/lib/portal/session";
import { portalDb } from "@/lib/portal/db";
import { getStudentClasses } from "@/lib/portal/learning";
import { getParentChildrenOverview } from "@/lib/portal/dashboard";
import { isPortalV2Enabled } from "@/lib/flags";
import { ChildrenPageV2 } from "@/components/portal/children-page";
import {
  SKILL_ORDER,
  SKILL_LABEL,
  LEVEL_LABEL,
  LEVEL_COLOR,
} from "@/lib/lms/skills";
import type { RoboticsSkill, SkillLevel } from "@prisma/client";
import {
  GraduationCap,
  Cake,
  School,
  HeartPulse,
  BookOpen,
} from "lucide-react";
import { formatDateVN } from "@/lib/format/date";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Hồ sơ con | Sata Robo",
  robots: { index: false },
};

export default async function HoSoConPage() {
  const { ctx, studentId } = await requireActiveStudent();
  const pdb = portalDb({
    parentUserId: ctx.parentUserId,
    childIds: ctx.children.map((c) => c.id),
  });

  // Portal v2 — trang "Các con" (danh sách) giống SataUI.
  if (isPortalV2Enabled()) {
    const kids = await getParentChildrenOverview(ctx.parentUserId);
    return <ChildrenPageV2 kids={kids} />;
  }

  const [student, classes, skillRows] = await Promise.all([
    pdb.student.findUnique({
      where: { id: studentId },
      select: {
        name: true,
        studentCode: true,
        dateOfBirth: true,
        currentGrade: true,
        school: true,
        healthNotes: true,
        allergies: true,
        notes: true,
      },
    }),
    getStudentClasses(studentId),
    pdb.studentSkillAssessment.findMany({
      where: { studentId },
      orderBy: { assessedAt: "desc" },
      select: { skill: true, level: true },
    }),
  ]);

  // Năng lực mới nhất mỗi kỹ năng.
  const latestSkills: Partial<Record<RoboticsSkill, SkillLevel>> = {};
  for (const r of skillRows)
    if (!latestSkills[r.skill]) latestSkills[r.skill] = r.level;
  const hasSkills = Object.keys(latestSkills).length > 0;

  return (
    <div className="space-y-5">
      <h1 className="text-xl font-bold text-neutral-900">Hồ sơ con</h1>

      {/* Thông tin học viên */}
      <section className="rounded-xl border border-neutral-200 bg-white p-4">
        <div className="mb-3 flex items-center gap-2">
          <div className="flex h-11 w-11 items-center justify-center rounded-full bg-orange-100 text-lg font-bold text-orange-700">
            {student?.name?.[0] ?? "?"}
          </div>
          <div>
            <p className="font-bold text-neutral-900">{student?.name ?? "—"}</p>
            {student?.studentCode && (
              <p className="text-xs text-neutral-600">{student.studentCode}</p>
            )}
          </div>
        </div>
        <dl className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <Info
            icon={Cake}
            label="Ngày sinh"
            value={
              student?.dateOfBirth ? formatDateVN(student.dateOfBirth) : "—"
            }
          />
          <Info
            icon={GraduationCap}
            label="Lớp (văn hoá)"
            value={student?.currentGrade ? `Lớp ${student.currentGrade}` : "—"}
          />
          <Info icon={School} label="Trường" value={student?.school ?? "—"} />
          <Info
            icon={HeartPulse}
            label="Ghi chú sức khoẻ"
            value={
              [
                student?.healthNotes,
                (student?.allergies ?? []).length
                  ? `Dị ứng: ${student!.allergies.join(", ")}`
                  : null,
              ]
                .filter(Boolean)
                .join(" · ") || "—"
            }
          />
        </dl>
      </section>

      {/* Lớp / khoá đang học */}
      <section className="rounded-xl border border-neutral-200 bg-white p-4">
        <h2 className="mb-2 flex items-center gap-1.5 text-sm font-bold uppercase tracking-wider text-neutral-700">
          <BookOpen className="h-4 w-4" /> Lớp / khoá đang học
        </h2>
        {classes.length === 0 ? (
          <p className="text-sm text-neutral-500">Chưa có lớp đang học.</p>
        ) : (
          <ul className="space-y-2">
            {classes.map((c) => (
              <li key={c.id} className="rounded-lg bg-neutral-50 px-3 py-2">
                <p className="text-sm font-medium text-neutral-800">
                  {c.classCode ? `${c.classCode} · ` : ""}
                  {c.name}
                </p>
                <p className="text-xs text-neutral-600">
                  {c.courseName}
                  {c.centerName ? ` · ${c.centerName}` : ""}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Năng lực robotics */}
      <section className="rounded-xl border border-neutral-200 bg-white p-4">
        <h2 className="mb-3 text-sm font-bold uppercase tracking-wider text-neutral-700">
          Năng lực robotics
        </h2>
        {!hasSkills ? (
          <p className="text-sm text-neutral-500">Chưa có đánh giá năng lực.</p>
        ) : (
          <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {SKILL_ORDER.filter((s) => latestSkills[s]).map((s) => {
              const lv = latestSkills[s] as SkillLevel;
              return (
                <li
                  key={s}
                  className="flex items-center justify-between gap-2 rounded-lg bg-neutral-50 px-3 py-2"
                >
                  <span className="text-sm text-neutral-700">
                    {SKILL_LABEL[s]}
                  </span>
                  <span
                    className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${LEVEL_COLOR[lv]}`}
                  >
                    {LEVEL_LABEL[lv]}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}

function Info({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Cake;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-start gap-2">
      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-neutral-500" />
      <div className="min-w-0">
        <dt className="text-[11px] uppercase tracking-wide text-neutral-500">
          {label}
        </dt>
        <dd className="break-words text-sm text-neutral-800">{value}</dd>
      </div>
    </div>
  );
}
