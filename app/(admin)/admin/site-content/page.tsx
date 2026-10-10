import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { resolveActor } from "@/lib/auth/actor";
import { scopedDb } from "@/lib/db-scope";
import { checkAnyPermission } from "@/lib/auth/check-permission";
import { PAGE_GATES } from "@/lib/auth/page-gates";
import { SiteContentClient } from "./client";
import { PageHelp } from "@/components/admin/ui/page-help";

export const metadata = { title: "Hình ảnh & nội dung trang | Admin" };

// 10 page slugs hỗ trợ override hero image + title + subtitle.
// Dùng existing SitePageContent key-value pattern (pageKey, contentKey, contentValue).
const PAGES = [
  { pageKey: "home", label: "Trang chủ" },
  { pageKey: "khoa-hoc", label: "Khoá học (overview)" },
  { pageKey: "khoa-hoc/laptrinhrobot", label: "Lập trình Robot (Sata1-8)" },
  { pageKey: "khoa-hoc/luyenthirobosim", label: "Luyện thi RoboSim" },
  { pageKey: "ve-chung-toi", label: "Về chúng tôi" },
  { pageKey: "tuyen-dung", label: "Tuyển dụng" },
  { pageKey: "lien-he", label: "Liên hệ" },
  { pageKey: "hoc-cu", label: "Học cụ" },
];

const FIELDS = [
  { key: "hero-image-url", label: "URL ảnh hero", type: "avatar" as const },
  { key: "hero-title", label: "Tiêu đề hero", type: "text" as const },
  { key: "hero-subtitle", label: "Phụ đề hero", type: "textarea" as const },
];

export default async function SiteContentPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!(await checkAnyPermission(PAGE_GATES["/site-content"]))) {
    redirect("/dashboard");
  }

  // Load tất cả site content cho 10 pages.
  // SitePageContent là model global (∉ SCOPED_MODELS) → sdb pass-through.
  const actor = await resolveActor(session.user.id);
  const allContent = await scopedDb(actor).sitePageContent.findMany({
    where: { pageKey: { in: PAGES.map((p) => p.pageKey) } },
  });

  // Build map: pageKey → { contentKey: contentValue }
  const contentMap: Record<string, Record<string, string>> = {};
  for (const page of PAGES) {
    contentMap[page.pageKey] = {};
  }
  for (const row of allContent) {
    if (contentMap[row.pageKey]) {
      contentMap[row.pageKey][row.contentKey] = row.contentValue;
    }
  }

  return (
    <div className="max-w-5xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-foreground">
          Hình ảnh & nội dung trang
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Ảnh bìa và tiêu đề của các trang công khai
        </p>
      </div>

      <PageHelp>
        <p>
          Override hero image + title + subtitle cho từng public page. Để trống
          ô = fallback về Unsplash mặc định (
          <code className="text-xs">lib/page-images.ts</code>).
        </p>
      </PageHelp>

      <SiteContentClient
        pages={PAGES}
        fields={FIELDS}
        initialContent={contentMap}
      />
    </div>
  );
}
