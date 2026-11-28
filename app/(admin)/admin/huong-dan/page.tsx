// app/(admin)/admin/huong-dan/page.tsx — hub "Hướng dẫn sử dụng" site admin.
// Nội dung tĩnh từ _content (sinh từ bộ md satarobo-huongdan/siteadmin) —
// không đụng DB; auth staff đã gate ở layout admin. Hướng dẫn viết cho góc nhìn
// SUPER_ADMIN — vai trò khác chỉ thấy các menu mình có quyền, nội dung đọc được
// hết (không lộ dữ liệu, chỉ mô tả thao tác).
import Link from "next/link";
import { ArrowRight, BookOpenText } from "lucide-react";
import { guidesByCategory } from "./_content";

export const metadata = { title: "Hướng dẫn sử dụng | Sata Robo Admin" };

export default function AdminGuidesPage() {
  const groups = guidesByCategory();

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-foreground">Hướng dẫn sử dụng</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Tài liệu hướng dẫn theo từng khối chức năng của trang quản trị — mỗi bài mô
          tả các thao tác chính kèm đường dẫn mở thẳng trang. Tính năng chưa hoàn
          thiện được ghi rõ &quot;sẽ cập nhật sau&quot;.
        </p>
      </div>

      <div className="space-y-8">
        {groups.map(({ category, guides }) => (
          <section key={category}>
            <h2 className="mb-3 flex items-center gap-2 text-xs font-semibold tracking-widest text-muted-foreground uppercase">
              <BookOpenText className="h-4 w-4 text-primary" aria-hidden />
              {category}
            </h2>
            <div className="grid gap-3 sm:grid-cols-2">
              {guides.map((g) => (
                <Link
                  key={g.slug}
                  href={`/huong-dan/${g.slug}`}
                  className="group flex items-start gap-3 rounded-xl border border-border bg-card p-4 transition-colors hover:border-primary hover:bg-primary-soft/40"
                >
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary text-xs font-bold text-white">
                    {String(g.order).padStart(2, "0")}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-bold text-foreground">
                      {g.title}
                    </span>
                    <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">
                      {g.description}
                    </span>
                  </span>
                  <ArrowRight
                    className="mt-1 h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-primary"
                    aria-hidden
                  />
                </Link>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
