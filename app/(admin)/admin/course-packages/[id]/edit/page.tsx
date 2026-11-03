import { auth } from "@/lib/auth";
import { resolveActor } from "@/lib/auth/actor";
import { scopedDb } from "@/lib/db-scope";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { PackageForm } from "../../_components/package-form";
import { checkPermission } from "@/lib/auth/check-permission";

interface EditPackagePageProps {
  params: Promise<{ id: string }>;
}

export default async function EditPackagePage({ params }: EditPackagePageProps) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!(await checkPermission("course-packages:edit"))) {
    redirect("/dashboard?error=unauthorized");
  }

  // Nhóm 01 L1 — CoursePackage/Course = catalog LMS toàn cục, scopedDb pass-through.
  const actor = await resolveActor(session.user.id);
  const sdb = scopedDb(actor);

  const { id } = await params;
  const pkg = await sdb.coursePackage.findUnique({
    where: { id },
    select: {
      id: true,
      slug: true,
      code: true,
      name: true,
      shortName: true,
      subtitle: true,
      shortDescription: true,
      description: true,
      ageGroup: true,
      level: true,
      lessons: true,
      duration: true,
      priceOriginal: true,
      priceEarlyBird: true,
      priceMember: true,
      features: true,
      highlights: true,
      curriculum: true,
      badge: true,
      color: true,
      displayOrder: true,
      isPublished: true,
      isFeatured: true,
      thumbnail: true,
      seoTitle: true,
      seoDescription: true,
      parentCourseSlug: true,
      courseId: true,
      // Phase TD-1 — Detail content
      audienceTag: true,
      audienceDescription: true,
      mission: true,
      outcomesJson: true,
      methodsJson: true,
      conditionsJson: true,
      noteForParents: true,
      faqsJson: true,
    },
  });

  if (!pkg) notFound();

  // FL1-05 — khoá dạy để liên kết (đổ dropdown).
  const courses = await sdb.course.findMany({
    where: { isActive: true },
    orderBy: [{ displayOrder: "asc" }, { name: "asc" }],
    select: { id: true, name: true, code: true, slug: true },
  });

  return (
    <div>
      <div className="mb-6">
        <Link
          href="/course-packages"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft className="h-4 w-4" />
          Quay lai
        </Link>
        <h1 className="mt-2 text-2xl font-bold text-foreground">Sửa: {pkg.name}</h1>
      </div>

      <PackageForm pkg={pkg} courses={courses} />
    </div>
  );
}
