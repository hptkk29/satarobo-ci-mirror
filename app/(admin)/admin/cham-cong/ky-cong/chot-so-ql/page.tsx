// /cham-cong/ky-cong/chot-so-ql — Chốt kỳ công theo số QL. CHỈ Quản trị tối cao thấy (người khác ⇒ 404),
// mỗi kỳ × cơ sở chốt MỘT lần. Luật: `lib/cham-cong/chot-so-ql.ts`.
import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { resolveActor } from "@/lib/auth/actor";
import { scopedDb } from "@/lib/db-scope";
import { PageHeader } from "@/components/admin/ui/page-header";
import { ChotSoQlForm } from "./_form";

export const metadata = { title: "Chốt kỳ theo số QL | Admin", robots: { index: false } };
export const dynamic = "force-dynamic";

export default async function ChotSoQlPage() {
  const session = await auth();
  if (!session?.user) redirect("/login?callbackUrl=%2Fcham-cong%2Fky-cong%2Fchot-so-ql");
  const actor = await resolveActor(session.user.id);
  if (!actor.isSuperAdmin) notFound();
  const db = scopedDb(actor);

  const [centers, daChot] = await Promise.all([
    db.center.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
    db.attendancePeriod.findMany({
      where: { lockReason: { startsWith: "Chốt theo số QL" } },
      select: { centerId: true, periodKey: true, lockedAt: true, status: true },
      orderBy: { lockedAt: "desc" },
      take: 50,
    }),
  ]);
  const ten = new Map(centers.map((c) => [c.id, c.name]));

  return (
    <div className="mx-auto w-full max-w-4xl space-y-6">
      <PageHeader
        title="Chốt kỳ công theo số quản lý"
        subtitle="Thay số máy tính bằng số QL đã chốt (công, phép, phút muộn/sớm, ghi chú) và khoá kỳ. Màn Kỳ công, Thống kê, file xuất và báo cáo đều đọc số này. Mỗi kỳ × cơ sở chỉ chốt MỘT lần, không sửa lại được."
      />
      <ChotSoQlForm centers={centers} />
      <section className="rounded-lg border bg-card p-4">
        <h2 className="mb-2 text-sm font-semibold">Kỳ đã chốt theo số QL</h2>
        {daChot.length === 0 ? (
          <p className="text-sm text-muted-foreground">Chưa có kỳ nào.</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {daChot.map((p) => (
              <li key={`${p.centerId}:${p.periodKey}`}>
                {p.periodKey} · {ten.get(p.centerId) ?? p.centerId} · {p.status === "LOCKED" ? "đang khoá" : "đã mở lại"}
                {p.lockedAt ? ` · ${p.lockedAt.toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" })}` : ""}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
