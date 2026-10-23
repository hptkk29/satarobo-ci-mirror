import Link from "next/link";
import { ChevronLeft, FileStack, Plus } from "lucide-react";
import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { scopedDb } from "@/lib/db-scope";
import { resolveActor } from "@/lib/auth/actor";
import { checkPermission } from "@/lib/auth/check-permission";
import { PageHelp } from "@/components/admin/ui/page-help";
import { PhanTrangBang } from "@/components/ui/phan-trang-bang";

export const dynamic = "force-dynamic";

const KIND_LABEL: Record<"CLASSWORK" | "HOMEWORK", string> = {
  CLASSWORK: "Bài trên lớp",
  HOMEWORK: "Bài về nhà",
};

export default async function AssignmentTemplatesPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  // Gate xem: ai quản lý bài tập mới vào được. TEACHER/CM chỉ view bài giao →
  // redirect mềm về danh sách bài tập (không vào khu quản lý mẫu).
  if (!(await checkPermission("assignments:create"))) {
    redirect("/assignments?error=unauthorized");
  }

  // Template gắn KHUNG CHƯƠNG TRÌNH (toàn hệ thống), KHÔNG gắn lớp → không center-scope
  // (AssignmentTemplate ∉ SCOPED_MODELS → scopedDb pass-through). Vẫn đi qua scopedDb
  // theo chuẩn R6-F1 (không import @/lib/db trần trong admin).
  const sdb = scopedDb(await resolveActor(session.user.id));
  const templates = await sdb.assignmentTemplate.findMany({
    include: {
      curriculum: { select: { name: true, version: true } },
      lesson: { select: { order: true, title: true } },
      _count: { select: { instances: true } },
    },
    orderBy: { updatedAt: "desc" },
    take: 200,
  });

  return (
    <div>
      <Link
        href="/assignments"
        className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className="h-4 w-4" /> Quay lại bài tập
      </Link>

      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-foreground">
            <FileStack className="h-6 w-6 text-primary" />
            Mẫu bài tập (theo khung chương trình)
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Kho mẫu bài tập dùng chung cho nhiều lớp
          </p>
        </div>
        <Link
          href="/assignments/templates/new"
          className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white shadow-sm hover:opacity-90"
        >
          <Plus className="h-4 w-4" />
          Tạo mẫu mới
        </Link>
      </div>

      <PageHelp>
        <p>
          Kho mẫu bài tập gắn khung chương trình / buổi học — KHÔNG gắn lớp. Từ
          một mẫu, sinh ra bài giao cho từng lớp (giữ truy vết về mẫu nguồn).
        </p>
      </PageHelp>

      <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
        <PhanTrangBang cuonNgang>
          <table className="min-w-full divide-y divide-border">
            <thead className="bg-muted">
              <tr>
                <th className="px-3 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Tiêu đề
                </th>
                <th className="px-3 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Khung CT
                </th>
                <th className="px-3 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Loại
                </th>
                <th className="px-3 py-3 text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Điểm
                </th>
                <th className="px-3 py-3 text-center text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Đã sinh
                </th>
                <th className="px-3 py-3 text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Hành động
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {templates.length === 0 ? (
                <tr>
                  <td
                    colSpan={6}
                    className="px-4 py-12 text-center text-sm text-muted-foreground"
                  >
                    Chưa có mẫu bài tập nào.{" "}
                    <Link
                      href="/assignments/templates/new"
                      className="text-primary hover:underline"
                    >
                      Tạo mẫu mới →
                    </Link>
                  </td>
                </tr>
              ) : (
                templates.map((t) => (
                  <tr key={t.id} className="hover:bg-muted/60">
                    <td className="px-3 py-3">
                      <div className="font-medium text-foreground line-clamp-1">
                        {t.title}
                      </div>
                      {t.lesson && (
                        <div className="text-xs text-muted-foreground">
                          Bài {t.lesson.order}: {t.lesson.title}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-3 text-xs text-muted-foreground">
                      {t.curriculum
                        ? `${t.curriculum.name} (v${t.curriculum.version})`
                        : "—"}
                    </td>
                    <td className="px-3 py-3 text-xs text-muted-foreground">
                      {KIND_LABEL[t.kind]}
                    </td>
                    <td className="px-3 py-3 text-right text-sm tabular-nums text-foreground">
                      {t.totalPoints}
                    </td>
                    <td className="px-3 py-3 text-center text-sm tabular-nums text-foreground">
                      {t._count.instances}
                    </td>
                    <td className="px-3 py-3 text-right">
                      <Link
                        href={`/assignments/templates/${t.id}/edit`}
                        className="inline-flex items-center gap-1 rounded-md border border-primary-soft px-2.5 py-1 text-xs font-semibold text-primary hover:bg-primary-soft"
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
    </div>
  );
}
