import Link from "next/link";
import { BookOpen, MessageSquareWarning, Plus } from "lucide-react";
import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { resolveActor } from "@/lib/auth/actor";
import { scopedDb } from "@/lib/db-scope";
import { checkPermission } from "@/lib/auth/check-permission";
import type { Prisma } from "@prisma/client";
import { PhanTrangBang } from "@/components/ui/phan-trang-bang";

export const dynamic = "force-dynamic";
export const metadata = { title: "Chương trình học | Admin" };

interface SearchParams {
  searchParams: Promise<{
    q?: string;
    courseId?: string;
    isActive?: string;
  }>;
}

export default async function CurriculumsPage({ searchParams }: SearchParams) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!(await checkPermission("curriculum:view"))) {
    redirect("/dashboard?error=unauthorized");
  }

  const sp = await searchParams;
  const q = sp.q?.trim() || undefined;
  const courseFilter = sp.courseId?.trim() || undefined;
  const activeFilter =
    sp.isActive === "true" ? true : sp.isActive === "false" ? false : undefined;

  const where: Prisma.CurriculumWhereInput = {
    ...(q ? { name: { contains: q, mode: "insensitive" as const } } : {}),
    ...(courseFilter ? { courseId: courseFilter } : {}),
    ...(activeFilter !== undefined ? { isActive: activeFilter } : {}),
  };

  // Nhóm 01 L1 — Curriculum/Course = giáo trình dùng chung toàn hệ thống (câu 74a),
  // scopedDb pass-through; dùng để sạch whitelist db trần.
  const actor = await resolveActor(session.user.id);
  const sdb = scopedDb(actor);

  // 01/10/2026 — mục sidebar "Đề xuất sửa giáo án" đã gỡ (chủ dự án): số đề xuất ĐANG MỞ nay
  // hiện ngay trên danh sách này, bấm vào tới thẳng tab Đề xuất của giáo trình đó. Chỉ người
  // duyệt được (`lesson-change:approve`) mới thấy — cùng cổng với tab Đề xuất.
  const canApproveChange = await checkPermission("lesson-change:approve");
  const [curriculums, courses, deXuatMo] = await Promise.all([
    sdb.curriculum.findMany({
      where,
      include: {
        course: { select: { name: true } },
        _count: { select: { lessons: true } },
      },
      orderBy: [{ courseId: "asc" }, { version: "desc" }],
      take: 200,
    }),
    sdb.course.findMany({
      where: { isActive: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    canApproveChange
      ? sdb.lessonChangeRequest.findMany({
          where: { status: "OPEN" },
          select: { lesson: { select: { curriculumId: true } } },
        })
      : Promise.resolve([]),
  ]);
  const deXuatTheoGiaoTrinh = new Map<string, number>();
  for (const r of deXuatMo) {
    const k = r.lesson.curriculumId;
    deXuatTheoGiaoTrinh.set(k, (deXuatTheoGiaoTrinh.get(k) ?? 0) + 1);
  }

  return (
    <div>
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-foreground">
            <BookOpen className="h-6 w-6 text-primary" />
            Giáo trình
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {curriculums.length > 0
              ? `${curriculums.length} giáo trình`
              : "Chưa có giáo trình nào"}
          </p>
        </div>
        <Link
          href="/curriculums/new"
          className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white shadow-sm hover:opacity-90"
        >
          <Plus className="h-4 w-4" />
          Thêm giáo trình
        </Link>
      </div>

      {deXuatMo.length > 0 && (
        <p className="mb-4 flex items-center gap-2 rounded-lg bg-state-warning-soft px-3 py-2 text-sm text-state-warning-ink">
          <MessageSquareWarning className="size-4 shrink-0" aria-hidden />
          <span>
            <b className="tabular-nums">{deXuatMo.length}</b> đề xuất sửa giáo án đang chờ duyệt — mở giáo trình có
            nhãn cam bên dưới.
          </span>
        </p>
      )}

      <form
        method="GET"
        className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4"
      >
        <input
          name="q"
          defaultValue={q}
          placeholder="Tìm theo tên giáo trình..."
          className="lg:col-span-2 rounded-lg border border-border px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
        />
        <select
          name="courseId"
          defaultValue={courseFilter ?? ""}
          className="rounded-lg border border-border px-3 py-2 text-sm focus:border-primary focus:outline-none"
        >
          <option value="">Tất cả khoá học</option>
          {courses.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <select
          name="isActive"
          defaultValue={sp.isActive ?? ""}
          className="rounded-lg border border-border px-3 py-2 text-sm focus:border-primary focus:outline-none"
        >
          <option value="">Mọi trạng thái</option>
          <option value="true">Đang sử dụng</option>
          <option value="false">Không sử dụng</option>
        </select>
        <button
          type="submit"
          className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white hover:opacity-90 sm:col-span-2 lg:col-span-4"
        >
          Áp dụng bộ lọc
        </button>
      </form>

      {courses.length === 0 ? (
        <div className="rounded-xl border border-state-warning-soft bg-state-warning-soft p-4 text-sm text-state-warning-ink">
          Chưa có khoá học nào. Tạo khoá học trước tại{" "}
          <Link
            href="/courses"
            className="font-semibold underline hover:text-state-warning-ink"
          >
            /admin/courses
          </Link>
          .
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
          <PhanTrangBang cuonNgang>
            <table className="min-w-full divide-y divide-border">
              <thead className="bg-muted">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Tên giáo trình
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Khoá học
                  </th>
                  {/* T5.2 — bỏ cột "Version" (bản giáo trình nay là số ẩn, không hiển thị). */}
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Trạng thái
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Số bài
                  </th>
                  <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Hành động
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {curriculums.length === 0 ? (
                  <tr>
                    <td
                      colSpan={5}
                      className="px-4 py-12 text-center text-sm text-muted-foreground"
                    >
                      Chưa có giáo trình nào khớp bộ lọc.{" "}
                      <Link
                        href="/curriculums/new"
                        className="text-primary hover:underline"
                      >
                        Tạo mới →
                      </Link>
                    </td>
                  </tr>
                ) : (
                  curriculums.map((c) => (
                    <tr key={c.id} className="hover:bg-muted/60">
                      <td className="px-4 py-3 font-medium text-foreground">
                        <span className="flex flex-wrap items-center gap-2">
                          {c.name}
                          {deXuatTheoGiaoTrinh.get(c.id) ? (
                            <Link
                              href={`/curriculums/${c.id}/edit?tab=de-xuat`}
                              className="inline-flex items-center gap-1 rounded-full bg-state-warning-soft px-2 py-0.5 text-xs font-semibold text-state-warning-ink hover:underline"
                            >
                              <MessageSquareWarning className="size-3" aria-hidden />
                              <span className="tabular-nums">{deXuatTheoGiaoTrinh.get(c.id)}</span> đề xuất
                            </Link>
                          ) : null}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-sm text-muted-foreground">{c.course.name}</td>
                      <td className="px-4 py-3">
                        {c.isActive ? (
                          <span className="inline-flex rounded-full bg-state-success-soft px-2.5 py-0.5 text-xs font-semibold text-state-success-ink">
                            Đang sử dụng
                          </span>
                        ) : (
                          <span className="inline-flex rounded-full bg-muted px-2.5 py-0.5 text-xs font-semibold text-muted-foreground">
                            Không dùng
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-sm tabular-nums font-semibold text-foreground">
                        {c._count.lessons}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Link
                          href={`/curriculums/${c.id}/edit`}
                          className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1 text-xs font-semibold text-foreground hover:bg-muted"
                        >
                          Mở
                        </Link>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </PhanTrangBang>
        </div>
      )}
    </div>
  );
}
