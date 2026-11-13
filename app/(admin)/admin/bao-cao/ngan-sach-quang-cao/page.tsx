import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { checkAnyPermission } from "@/lib/auth/check-permission";
import { PAGE_GATES } from "@/lib/auth/page-gates";
import { resolveActor, type Actor } from "@/lib/auth/actor";
import { scopedDb } from "@/lib/db-scope";
import { safeCache } from "@/lib/cache/safe-cache";
import { CACHE_TAGS } from "@/lib/cache/tags";
import { actorScopeKey } from "@/lib/cache/scope-key";
import { monthKeyVN } from "@/lib/reports/lead";
import { resolveReportFilters } from "@/lib/reports/filters";
import { adsBudgetTargetListWhere } from "@/lib/reports/ads-budget-target";
import { PhanTrangBang } from "@/components/ui/phan-trang-bang";
import { AdsBudgetTargetForm } from "./_components/ads-budget-target-form";

export const metadata = { title: "Chỉ tiêu ngân sách quảng cáo | Admin" };
export const dynamic = "force-dynamic";

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-border bg-card p-4">
      <h2 className="mb-3 text-sm font-semibold text-foreground">{title}</h2>
      {children}
    </section>
  );
}

/**
 * Chỉ tiêu đã đặt, trong tầm nhìn của actor.
 *
 * ⚠️ `AdsBudgetTarget` ∈ SCOPE_EXEMPT ⇒ `scopedDb` là PASS-THROUGH ở bảng này. `where`
 * phải do `adsBudgetTargetListWhere` sinh — bỏ nó đi là mọi vai cấp cơ sở đọc được chỉ
 * tiêu của cơ sở khác, im lặng, không lỗi.
 */
async function loadAdsBudgetTargets(actor: Actor) {
  const sdb = scopedDb(actor);
  return sdb.adsBudgetTarget.findMany({
    where: adsBudgetTargetListWhere(actor),
    select: {
      id: true,
      centerId: true,
      period: true,
      targetAmount: true,
      note: true,
      updatedAt: true,
    },
    orderBy: [{ period: "desc" }, { centerId: "asc" }],
    take: 500,
  });
}

export default async function AdsBudgetTargetPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!(await checkAnyPermission(PAGE_GATES["/bao-cao/ngan-sach-quang-cao"]))) {
    redirect("/dashboard?error=unauthorized");
  }

  const actor = await resolveActor(session.user.id);
  // Dùng lại bộ lọc chung để lấy danh sách cơ sở CHỌN ĐƯỢC (đã lọc theo tầm nhìn) +
  // cờ "được đặt chỉ tiêu toàn hệ thống". Không truyền searchParams: màn này không có
  // bộ lọc ngày, cơ sở chọn ngay trong biểu mẫu.
  const fc = await resolveReportFilters(actor, {});

  const rows = await safeCache(
    () => loadAdsBudgetTargets(actor),
    ["ads-budget-target-list", actorScopeKey(actor)],
    { tags: [CACHE_TAGS.report], revalidate: 120 },
  )();

  const centerName = new Map(fc.visibleCenters.map((c) => [c.id, c.name]));
  const currentPeriod = monthKeyVN(new Date());

  return (
    <div className="space-y-5 p-4">
      <div>
        <h1 className="text-xl font-bold text-foreground">Chỉ tiêu ngân sách quảng cáo</h1>
        <p className="text-sm text-muted-foreground">
          Đặt tay theo tháng và theo từng cơ sở, đơn vị{" "}
          <span className="font-medium">đồng</span>. Đây là số{" "}
          <span className="font-medium">đặt ra để chi</span> — số{" "}
          <span className="font-medium">đã chi thật</span> lấy tự động từ tài khoản quảng
          cáo và hiện ở tab Chi phí Marketing, không nhập ở đây.
        </p>
      </div>

      <Card title="Đặt / sửa chỉ tiêu">
        <AdsBudgetTargetForm
          centers={fc.visibleCenters}
          canSetGlobal={fc.isGlobalAllowed}
          defaultCenterId={fc.selection}
          defaultPeriod={currentPeriod}
        />
        <p className="mt-2 text-xs text-muted-foreground">
          Chỉ tiêu lưu theo (cơ sở, kỳ). Đặt lại cùng cơ sở + kỳ sẽ ghi đè giá trị cũ.
          Chỉ tiêu &ldquo;Toàn hệ thống&rdquo; và chỉ tiêu từng cơ sở là hai con số độc
          lập — báo cáo không cộng dồn hai loại với nhau. Chưa đặt chỉ tiêu cho một kỳ thì
          báo cáo ghi &ldquo;Chưa đặt chỉ tiêu&rdquo;, không hiểu thành 0.
        </p>
      </Card>

      <Card title="Chỉ tiêu đã đặt">
        <div className="overflow-x-auto">
          <PhanTrangBang>
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted-foreground">
                <tr>
                  <th className="px-3 py-2">Kỳ</th>
                  <th className="px-3 py-2">Cơ sở</th>
                  <th className="px-3 py-2 text-right">Chỉ tiêu (đ)</th>
                  <th className="px-3 py-2">Ghi chú</th>
                  <th className="px-3 py-2">Cập nhật</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-t">
                    <td className="px-3 py-2">{r.period}</td>
                    <td className="px-3 py-2">
                      {r.centerId === null ? (
                        <span className="font-medium">Toàn hệ thống</span>
                      ) : (
                        (centerName.get(r.centerId) ?? "Cơ sở không còn hoạt động")
                      )}
                    </td>
                    <td className="px-3 py-2 text-right font-medium">
                      {r.targetAmount.toLocaleString("vi-VN")}
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">{r.note ?? "—"}</td>
                    <td className="px-3 py-2 text-muted-foreground">
                      {r.updatedAt.toLocaleDateString("vi-VN")}
                    </td>
                  </tr>
                ))}
                {rows.length === 0 ? (
                  <tr>
                    <td className="px-3 py-4 text-center text-muted-foreground" colSpan={5}>
                      Chưa đặt chỉ tiêu ngân sách nào trong phạm vi này.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </PhanTrangBang>
        </div>
      </Card>
    </div>
  );
}
