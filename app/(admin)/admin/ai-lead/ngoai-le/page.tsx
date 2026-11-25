// app/(admin)/admin/ai-lead/ngoai-le/page.tsx — Ngoại lệ (Exception Center) của hồ sơ AI Lead: hồ sơ lỗi tạo lead · lead chưa có sale · hồ sơ quá hạn SLA.
// Đủ bốn trạng thái của DESIGN.md §5: tải (Suspense + khung chờ) · rỗng · lỗi · KHÔNG CÓ QUYỀN. Xem = `ai-leads:view` (cùng cổng với «Hồ sơ chờ AI»); mọi nút ghi gác `ai-leads:review` ở Server Action + từng dòng.
import { Suspense } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { NoPermission } from "@/components/admin/ui/states";
import { PageHeader } from "@/components/admin/ui/page-header";
import { auth } from "@/lib/auth";
import { checkAnyPermission } from "@/lib/auth/check-permission";
import { PAGE_GATES } from "@/lib/auth/page-gates";
import { KhungChoNgoaiLe } from "./_components/khung-cho";
import { NoiDungNgoaiLe } from "./_components/noi-dung-ngoai-le";
import { docBoLocNgoaiLe } from "./_lib/doc-bo-loc";

export const dynamic = "force-dynamic";
export const metadata = { title: "Ngoại lệ AI Lead | Admin Sata Robo" };

type SP = Promise<Record<string, string | string[] | undefined>>;

function QuayLai() {
  return (
    <Link href="/ai-lead" className="mb-3 inline-flex h-11 items-center gap-1.5 rounded-lg pr-3 text-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 sm:h-9">
      <ArrowLeft className="h-4 w-4" aria-hidden /> Danh sách hồ sơ chờ AI
    </Link>
  );
}

export default async function NgoaiLeAiLeadPage({ searchParams }: { searchParams: SP }) {
  const session = await auth();
  if (!session?.user) redirect("/login?callbackUrl=%2Fai-lead%2Fngoai-le");
  const tieuDe = (
    <PageHeader title="Ngoại lệ AI Lead" subtitle="Hồ sơ cần người can thiệp: tạo lead bị lỗi, lead chưa có sale phụ trách, hoặc quá hạn xử lý." />
  );
  // Cùng quyền xem với «Hồ sơ chờ AI»: ngoại lệ là các hồ sơ của chính màn đó, chỉ lọc theo tình trạng.
  if (!(await checkAnyPermission([...PAGE_GATES["/ai-lead/ngoai-le"]]))) {
    return (
      <div className="mx-auto w-full max-w-[120rem]">
        <QuayLai />
        {tieuDe}
        <NoPermission what="Ngoại lệ AI Lead" permission="ai-leads:view" askWho="quản trị viên hệ thống (Quản lý cơ sở và Marketing Hội sở có quyền này theo mặc định)" />
      </div>
    );
  }

  const loc = docBoLocNgoaiLe(await searchParams);
  return (
    <div className="mx-auto w-full max-w-[120rem]">
      <QuayLai />
      {tieuDe}
      <Suspense key={JSON.stringify(loc)} fallback={<KhungChoNgoaiLe />}>
        <NoiDungNgoaiLe loc={loc} userId={session.user.id} />
      </Suspense>
    </div>
  );
}
