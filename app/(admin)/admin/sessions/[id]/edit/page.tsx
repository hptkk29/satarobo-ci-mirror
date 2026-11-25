import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { resolveActor } from "@/lib/auth/actor";
import { scopedDb, getModelVisibleCenterIds } from "@/lib/db-scope";
import { SessionForm } from "../../_components/session-form";

interface Props {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ returnTo?: string }>;
}

export const dynamic = "force-dynamic";

export default async function EditSessionPage({ params, searchParams }: Props) {
  const auth_ = await auth();
  if (!auth_?.user) redirect("/login");

  const { id } = await params;
  const { returnTo } = await searchParams;

  // Cách ly cơ sở: ClassSession KHÔNG ∈ SCOPED_MODELS (không có centerId trực tiếp)
  // → scopedDb không auto-scope findUnique. Scope THỦ CÔNG qua class.centerId theo
  // tầm nhìn cơ sở của model Class. Class.findMany được sdb auto-scope.
  const actor = await resolveActor(auth_.user.id);
  const sdb = scopedDb(actor);
  const visibleClassCenters = getModelVisibleCenterIds("Class", actor);
  const classScopeWhere =
    visibleClassCenters === "ALL"
      ? undefined
      : { centerId: { in: visibleClassCenters } };

  const [session, classes, lessons, categories] = await Promise.all([
    sdb.classSession.findFirst({
      where: { id, ...(classScopeWhere ? { class: classScopeWhere } : {}) },
      include: { class: { select: { name: true } } },
    }),
    sdb.class.findMany({
      where: { deletedAt: null },
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

  if (!session) notFound();

  return (
    <div>
      <h1 className="mb-6 text-3xl font-black text-foreground">
        Sửa buổi học: <span className="font-bold text-primary">{session.class.name}</span>
      </h1>
      <SessionForm
        returnTo={returnTo}
        session={{
          id: session.id,
          classId: session.classId,
          date: session.date,
          topic: session.topic,
          notes: session.notes,
          lessonId: session.lessonId,
          lessonNotes: session.lessonNotes,
          sessionCategoryId: session.sessionCategoryId,
        }}
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
