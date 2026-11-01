import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { checkPermission } from "@/lib/auth/check-permission";
import { resolveActor } from "@/lib/auth/actor";
import { scopedDb } from "@/lib/db-scope";
import { CriteriaManager } from "../_components/criteria-manager";
import { PageHelp } from "@/components/admin/ui/page-help";

export const metadata = { title: "Tiêu chí học bạ | Admin" };
export const dynamic = "force-dynamic";

export default async function ReportCardCriteriaPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  // Cấu hình tiêu chí = quyền duyệt (Đào tạo/Quản lý). report-cards:review đã có ở v2,
  // scope GLOBAL (#09) — gate không truyền target, đúng R1.
  if (!(await checkPermission("report-cards:review")))
    redirect("/report-cards");

  // Course/ReportCardCriterion không center-scope → sdb pass-through. Dùng sdb để file
  // không phải import db trần (ESLint db-import-allowlist).
  const sdb = scopedDb(await resolveActor(session.user.id));

  const courses = await sdb.course.findMany({
    where: { isActive: true },
    orderBy: [
      { isTeachable: "desc" },
      { displayOrder: "asc" },
      { name: "asc" },
    ],
    take: 300,
    select: {
      id: true,
      name: true,
      isTeachable: true,
      // Tất cả tiêu chí (kể cả inactive) để bật/tắt.
    },
  });

  const criteria = await sdb.reportCardCriterion.findMany({
    where: { courseId: { in: courses.map((c) => c.id) } },
    orderBy: [{ order: "asc" }, { createdAt: "asc" }],
    select: { id: true, courseId: true, name: true, order: true, active: true },
  });

  const byCourse = new Map<string, typeof criteria>();
  for (const c of criteria) {
    const list = byCourse.get(c.courseId) ?? [];
    list.push(c);
    byCourse.set(c.courseId, list);
  }

  return (
    <div className="space-y-5 p-4">
      <div>
        <Link href="/report-cards" className="text-sm text-primary">
          ← Học bạ năng lực
        </Link>
        <h1 className="mt-1 text-xl font-bold text-foreground">
          Cấu hình tiêu chí năng lực
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Tiêu chí chấm học bạ theo từng khoá
        </p>
      </div>

      <PageHelp>
        <p>
          Đào tạo cấu hình tiêu chí theo từng khoá học. GV chấm thang 1–4 cho
          mỗi tiêu chí khi nhập học bạ.
        </p>
      </PageHelp>

      <CriteriaManager
        courses={courses.map((c) => ({
          id: c.id,
          name: c.name,
          isTeachable: c.isTeachable,
          criteria: byCourse.get(c.id) ?? [],
        }))}
      />
    </div>
  );
}
