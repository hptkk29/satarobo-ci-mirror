// app/(portal)/portal/huong-dan/page.tsx — hub "Hướng dẫn sử dụng" cổng PH.
// Nội dung tĩnh từ _content (sinh từ bộ md satarobo-huongdan/sitephuhuynh) —
// không đụng DB, không cần activeStudent; auth PARENT đã gate ở layout.
import Link from "next/link";
import { ArrowRight, BookOpenText } from "lucide-react";
import { guidesByCategory } from "./_content";

export const metadata = {
  title: "Hướng dẫn sử dụng | Cổng học viên Sata Robo",
};

export default function PortalGuidesPage() {
  const groups = guidesByCategory();

  return (
    <div>
      <div className="mb-5 sm:mb-6">
        <h1 className="text-xl font-extrabold tracking-tight text-foreground sm:text-2xl">
          Hướng dẫn sử dụng
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Tài liệu hướng dẫn chi tiết từng trang của cổng phụ huynh — chia theo
          nhóm chức năng, mỗi bài có các bước thao tác và đường dẫn mở thẳng
          trang tương ứng.
        </p>
      </div>

      <div className="space-y-8">
        {groups.map(({ category, guides }) => (
          <section key={category}>
            <h2 className="mb-3 flex items-center gap-2 text-sm font-bold tracking-wide text-muted-foreground uppercase">
              <BookOpenText className="size-4 text-accent" aria-hidden />
              {category}
            </h2>
            <div className="grid gap-3 sm:grid-cols-2">
              {guides.map((g) => (
                <Link
                  key={g.slug}
                  href={`/portal/huong-dan/${g.slug}`}
                  className="group flex items-start gap-3 rounded-xl border border-border bg-card p-4 transition-colors hover:border-accent/40 hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring outline-none"
                >
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-accent text-xs font-bold text-accent-foreground">
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
                    className="mt-1 size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-accent"
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
