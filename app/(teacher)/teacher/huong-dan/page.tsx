// app/(teacher)/teacher/huong-dan/page.tsx — hub "Hướng dẫn sử dụng" site GV.
// Nội dung tĩnh từ _content (sinh từ bộ md satarobo-huongdan/sitegiaovien) —
// không đụng DB; auth + role gate đã nằm ở layout site GV.
import Link from "next/link";
import { ArrowRight, BookOpenText } from "lucide-react";
import { PageHeader } from "../_components/ui/page-header";
import { guidesByCategory } from "./_content";

export const metadata = { title: "Hướng dẫn sử dụng | Giáo viên Sata Robo" };

export default function TeacherGuidesPage() {
  const groups = guidesByCategory();

  return (
    <div>
      <PageHeader
        title="Hướng dẫn sử dụng"
        subtitle="Tài liệu hướng dẫn chi tiết từng trang của site giáo viên — chia theo nhóm chức năng, mỗi bài có các bước thao tác và đường dẫn mở thẳng trang tương ứng."
      />

      <div className="space-y-8">
        {groups.map(({ category, guides }) => (
          <section key={category}>
            <h2 className="mb-3 flex items-center gap-2 text-sm font-bold tracking-wide text-muted-foreground uppercase">
              <BookOpenText className="h-4 w-4 text-primary" aria-hidden />
              {category}
            </h2>
            <div className="grid gap-3 sm:grid-cols-2">
              {guides.map((g) => (
                <Link
                  key={g.slug}
                  href={`/teacher/huong-dan/${g.slug}`}
                  className="group flex items-start gap-3 rounded-xl border border-border bg-card p-4 transition-colors hover:border-primary/40 hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring outline-none"
                >
                  <span className="brand-gradient flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-xs font-bold text-white">
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
