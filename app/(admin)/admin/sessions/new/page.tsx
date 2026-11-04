import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { scopedDb } from "@/lib/db-scope";
import { resolveActor } from "@/lib/auth/actor";
import { SessionForm } from "../_components/session-form";

export const dynamic = "force-dynamic";

interface Props {
  searchParams: Promise<{ classId?: string }>;
}

export default async function NewSessionPage({ searchParams }: Props) {
  // Cách ly cơ sở: dropdown lớp phải theo tầm nhìn cơ sở của actor (Class ∈ SCOPED_MODELS
  // → sdb.class auto inject centerId). Lesson không scope theo cơ sở → sdb pass-through.
  const session = await auth();
  if (!session?.user) redirect("/login");
  const actor = await resolveActor(session.user.id);
  const sdb = scopedDb(actor);

  const sp = await searchParams;
  const [classes, lessons, categories] = await Promise.all([
    sdb.class.findMany({
      where: { deletedAt: null, isActive: true },
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        courseId: true,
        course: { select: { name: true } },
        center: { select: { name: true } },
      },
      take: 200,
    }),
    sdb.lesson.findMany({
      where: { curriculum: { isActive: true } },
      orderBy: [{ curriculumId: "asc" }, { order: "asc" }],
      select: {
        id: true,
        order: true,
        title: true,
        curriculum: { select: { name: true, courseId: true } },
      },
      take: 1000,
    }),
    // Phân loại buổi đang dùng — danh mục dùng chung, KHÔNG scope theo cơ sở.
    sdb.sessionCategory.findMany({
      where: { isActive: true },
      orderBy: [{ displayOrder: "asc" }, { code: "asc" }],
      select: { id: true, name: true, isDefault: true },
    }),
  ]);

  return (
    <div>
      <h1 className="mb-6 text-3xl font-black text-foreground">Thêm buổi học</h1>
      <SessionForm
        defaultClassId={sp.classId}
        classes={classes.map((c) => ({
          id: c.id,
          name: c.name,
          courseId: c.courseId,
          courseName: c.course.name,
          centerName: c.center?.name ?? null,
        }))}
        lessons={lessons.map((l) => ({
          id: l.id,
          order: l.order,
          title: l.title,
          curriculumName: l.curriculum.name,
          courseId: l.curriculum.courseId,
        }))}
        categories={categories}
      />
    </div>
  );
}
