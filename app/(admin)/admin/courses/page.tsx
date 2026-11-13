import Link from "next/link";
import { redirect } from "next/navigation";
import { BookOpen } from "lucide-react";
import { auth } from "@/lib/auth";
import { checkPermission } from "@/lib/auth/check-permission";
import { scopedDb } from "@/lib/db-scope";
import { resolveActor } from "@/lib/auth/actor";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { PageHelp } from "@/components/admin/ui/page-help";
import { PhanTrangBang } from "@/components/ui/phan-trang-bang";

export const metadata = { title: "Khoá dạy | Admin" };
export const dynamic = "force-dynamic";

export default async function CoursesPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!(await checkPermission("courses:view"))) {
    redirect("/dashboard?error=unauthorized");
  }
  const canEditPackages = await checkPermission("course-packages:edit");

  // Course là catalog toàn hệ thống (không center-scoped); scopedDb pass-through.
  const sdb = scopedDb(await resolveActor(session.user.id));
  const courses = await sdb.course.findMany({
    orderBy: [{ displayOrder: "asc" }, { name: "asc" }],
    select: {
      id: true,
      name: true,
      slug: true,
      ageRange: true,
      level: true,
      price: true,
      isActive: true,
      _count: { select: { discounts: true } },
    },
  });

  return (
    <div>
      <div className="mb-6 flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary-soft">
          <BookOpen className="h-5 w-5 text-primary" />
        </div>
        <div className="flex-1">
          <h1 className="text-2xl font-bold text-foreground">
            Khoá dạy (chương trình giảng)
          </h1>
        </div>
        {canEditPackages && (
          <Link
            href="/course-packages"
            className="shrink-0 rounded-lg border border-border px-3 py-1.5 text-sm font-semibold text-foreground hover:bg-muted"
          >
            Tất cả gói bán →
          </Link>
        )}
      </div>

      <PageHelp>
        <p>
          Khoá dạy = đơn vị GIẢNG (chương trình, độ tuổi, trình độ, ưu đãi). Để
          BÁN/định giá, mở chi tiết khoá để quản lý{" "}
          <span className="font-medium">gói bán liên kết</span>.
        </p>
      </PageHelp>

      <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
        <PhanTrangBang cuonNgang>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Tên khoá</TableHead>
                <TableHead>Độ tuổi</TableHead>
                <TableHead>Trình độ</TableHead>
                <TableHead className="text-right">Giá</TableHead>
                <TableHead className="text-right">Ưu đãi</TableHead>
                <TableHead>Trạng thái</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {courses.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={6}
                    className="py-8 text-center text-muted-foreground"
                  >
                    Chưa có khoá học nào
                  </TableCell>
                </TableRow>
              ) : (
                courses.map((c) => (
                  <TableRow key={c.id} className="hover:bg-muted/60">
                    <TableCell className="font-medium">
                      <Link
                        href={`/courses/${c.id}`}
                        className="text-state-info-ink hover:underline"
                      >
                        {c.name}
                      </Link>
                      <div className="text-xs text-muted-foreground">
                        /{c.slug}
                      </div>
                    </TableCell>
                    <TableCell className="text-sm">{c.ageRange || "—"}</TableCell>
                    <TableCell className="text-sm">{c.level || "—"}</TableCell>
                    <TableCell className="text-right text-sm tabular-nums">
                      {c.price != null
                        ? `${c.price.toLocaleString("vi-VN")}đ`
                        : "—"}
                    </TableCell>
                    <TableCell className="text-right text-sm tabular-nums">
                      {c._count.discounts}
                    </TableCell>
                    <TableCell>
                      {c.isActive ? (
                        <Badge className="bg-state-success-soft text-state-success-ink hover:bg-state-success-soft-hover">
                          Hoạt động
                        </Badge>
                      ) : (
                        <Badge className="bg-muted text-foreground hover:bg-muted">
                          Tắt
                        </Badge>
                      )}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </PhanTrangBang>
      </div>
    </div>
  );
}
