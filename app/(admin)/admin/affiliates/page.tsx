import { redirect } from "next/navigation";
import { Share2 } from "lucide-react";
import { auth } from "@/lib/auth";
import { checkPermission } from "@/lib/auth/check-permission";
import { resolveActor } from "@/lib/auth/actor";
import { scopedDb } from "@/lib/db-scope";
import { AffiliateManager } from "./_components/affiliate-manager";
import { PageHelp } from "@/components/admin/ui/page-help";

export const metadata = { title: "Nguồn giới thiệu | Admin" };
export const dynamic = "force-dynamic";

// BGĐ 31/07 — "leads thêm nguồn tương tự aff": danh sách người/đối tác giới thiệu,
// mã + link `?ref=`, và số lead / lead đã chốt của từng người để đối soát.
export default async function AffiliatesPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!(await checkPermission("leads:view-all")))
    redirect("/dashboard?error=unauthorized");
  const canManage = await checkPermission("leads:assign");

  const sdb = scopedDb(await resolveActor(session.user.id));
  const [affiliates, centers] = await Promise.all([
    sdb.affiliate.findMany({
      orderBy: [{ isActive: "desc" }, { createdAt: "desc" }],
      select: {
        id: true,
        code: true,
        name: true,
        phone: true,
        email: true,
        centerId: true,
        commissionPercent: true,
        isActive: true,
        note: true,
        _count: { select: { leads: true } },
      },
    }),
    sdb.center.findMany({
      where: { isActive: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
  ]);

  // Lead đã CHỐT theo từng affiliate — đo hiệu quả thật, không chỉ đếm lead.
  // "Chốt" = DA_DANG_KY. Trước GĐ5 phải liệt kê 2 giá trị ENROLLED + REGISTERED
  // ("đã ghi danh" và "đã ghi nhận tiền" là hai bậc riêng); enum mới gộp chúng làm
  // một nên chỉ còn một giá trị, KHÔNG phải bỏ sót bậc nào.
  const closedLeads = await sdb.lead.findMany({
    where: {
      affiliateId: { not: null },
      status: "DA_DANG_KY",
      deletedAt: null,
    },
    select: { affiliateId: true },
  });
  const convertedBy = new Map<string, number>();
  for (const l of closedLeads) {
    if (!l.affiliateId) continue;
    convertedBy.set(l.affiliateId, (convertedBy.get(l.affiliateId) ?? 0) + 1);
  }

  return (
    <div className="max-w-5xl space-y-4 p-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold text-foreground">
          <Share2 className="h-6 w-6 text-primary" /> Nguồn giới thiệu
          (Affiliate)
        </h1>
      </div>

      <PageHelp>
        <p>
          Mỗi người giới thiệu có 1 mã; chia sẻ link kèm <code>?ref=MÃ</code> để
          lead tự gắn về đúng người. Hoa hồng đối soát tay theo % tham chiếu
          (chờ quy chế chính thức).
        </p>
      </PageHelp>

      <AffiliateManager
        canManage={canManage}
        centers={centers}
        affiliates={affiliates.map((a) => ({
          id: a.id,
          code: a.code,
          name: a.name,
          phone: a.phone,
          email: a.email,
          centerId: a.centerId,
          commissionPercent: a.commissionPercent,
          isActive: a.isActive,
          note: a.note,
          leadCount: a._count.leads,
          convertedCount: convertedBy.get(a.id) ?? 0,
        }))}
      />
    </div>
  );
}
