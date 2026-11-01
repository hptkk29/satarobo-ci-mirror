import Link from "next/link";
import { redirect } from "next/navigation";
import { Plus } from "lucide-react";
import { auth } from "@/lib/auth";
import { resolveActor } from "@/lib/auth/actor";
import { scopedDb } from "@/lib/db-scope";
import { NewsListRow } from "./_components/news-list-row";
import { PhanTrangBang } from "@/components/ui/phan-trang-bang";

export const dynamic = "force-dynamic";

export default async function NewsAdminPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  // News là nội dung global (∉ SCOPED_MODELS) → sdb pass-through.
  const actor = await resolveActor(session.user.id);
  const news = await scopedDb(actor).news.findMany({
    orderBy: [{ displayOrder: "asc" }, { publishedAt: "desc" }],
    select: {
      id: true,
      slug: true,
      title: true,
      category: true,
      isPublished: true,
      isFeatured: true,
      publishedAt: true,
    },
  });

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-black text-foreground">Tin Tức</h1>
          <p className="mt-1 text-muted-foreground">
            Quản lý bài viết Markdown · {news.length} bài
          </p>
        </div>
        <Link
          href="/news/new"
          className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2 font-bold text-white shadow-md hover:bg-primary-dark"
        >
          <Plus className="h-5 w-5" />
          Thêm bài viết
        </Link>
      </div>

      <div className="overflow-hidden rounded-xl border border-border bg-card">
        <PhanTrangBang cuonNgang>
          <table className="w-full">
            <thead className="border-b border-border bg-muted text-left">
              <tr>
                <th className="p-4 text-xs font-bold uppercase tracking-wider text-foreground">Tiêu đề</th>
                <th className="p-4 text-xs font-bold uppercase tracking-wider text-foreground">Danh mục</th>
                <th className="p-4 text-center text-xs font-bold uppercase tracking-wider text-foreground">Trạng thái</th>
                <th className="p-4 text-xs font-bold uppercase tracking-wider text-foreground">Ngày đăng</th>
                <th className="p-4 text-right text-xs font-bold uppercase tracking-wider text-foreground">Thao tác</th>
              </tr>
            </thead>
            <tbody>
              {news.length === 0 ? (
                <tr>
                  <td colSpan={5} className="p-12 text-center text-muted-foreground">
                    Chưa có bài viết nào.{" "}
                    <Link href="/news/new" className="text-primary hover:underline">
                      Tạo bài đầu tiên →
                    </Link>
                  </td>
                </tr>
              ) : (
                news.map((n) => <NewsListRow key={n.id} news={n} />)
              )}
            </tbody>
          </table>
        </PhanTrangBang>
      </div>
    </div>
  );
}
