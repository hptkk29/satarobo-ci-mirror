import { redirect } from "next/navigation";
import Link from "next/link";
import { Users, CheckCircle2, Percent, Loader2 } from "lucide-react";
import { auth } from "@/lib/auth";
import { checkPermission } from "@/lib/auth/check-permission";
import { scopedDb } from "@/lib/db-scope";
import { resolveActor } from "@/lib/auth/actor";
import type { LeadStatus } from "@prisma/client";
import { StatCardAdmin } from "@/components/design-system/admin/stat-card-admin";
import { FunnelChart } from "@/components/charts/funnel-chart";
import { BarChart } from "@/components/charts/bar-chart";
import {
  LEAD_STATUS_LABEL,
  LEAD_CLOSED_STATUSES,
  LEAD_FUNNEL_STAGES,
} from "@/lib/leads/status";
import { PhanTrangBang } from "@/components/ui/phan-trang-bang";

export const metadata = { title: "CRM Dashboard | Admin" };
export const dynamic = "force-dynamic";

// GĐ0 — hằng phễu chuyển về @/lib/leads/status. Bản chép cũ bỏ sót TRIAL_IN_PROGRESS
// và REGISTERED nên cột "Học thử" và "Đã chốt" đếm thiếu; nay đã đủ.
const FUNNEL_STAGES = LEAD_FUNNEL_STAGES;

export default async function CrmDashboardPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!(await checkPermission("leads:view-all"))) redirect("/dashboard");

  // Cách ly cơ sở: Lead ∈ SCOPED_MODELS → đọc qua scopedDb để CENTER_MANAGER@CS1
  // không thấy lead CS2. groupBy/count auto-inject centerId theo tầm nhìn của actor.
  // User là SCOPE_EXEMPT (identity toàn cục) → sdb pass-through.
  const actor = await resolveActor(session.user.id);
  const sdb = scopedDb(actor);

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  const [
    byStatus,
    bySource,
    byAssigned,
    enrolledByAssigned,
    sales,
    monthTotal,
    monthEnrolled,
    open,
  ] = await Promise.all([
      sdb.lead.groupBy({
        by: ["status"],
        where: { deletedAt: null },
        _count: { _all: true },
      }),
      sdb.lead.groupBy({
        by: ["source"],
        where: { deletedAt: null },
        _count: { _all: true },
      }),
      sdb.lead.groupBy({
        by: ["assignedToId"],
        where: { deletedAt: null, assignedToId: { not: null } },
        _count: { _all: true },
      }),
      sdb.lead.groupBy({
        by: ["assignedToId"],
        where: { deletedAt: null, assignedToId: { not: null }, status: "DA_DANG_KY" },
        _count: { _all: true },
      }),
      sdb.user.findMany({
        where: { roles: { has: "SALES_CSM" }, isActive: true, deletedAt: null },
        select: { id: true, name: true, email: true },
        orderBy: { name: "asc" },
      }),
      sdb.lead.count({ where: { deletedAt: null, createdAt: { gte: monthStart } } }),
      sdb.lead.count({
        where: { deletedAt: null, status: "DA_DANG_KY", updatedAt: { gte: monthStart } },
      }),
      // "Đang xử lý" — phải ĐẾM RIÊNG, không cộng dồn từ `byStatus` được.
      //
      // ⚠️ Sau GĐ5, `LEAD_CLOSED_STATUSES` chỉ còn `DA_MAT` (cố ý: lead đã đăng ký mà
      // chưa xếp lớp vẫn là việc đang mở). Nhưng lead đã convert XONG cũng mang
      // `DA_DANG_KY`, nên gộp theo status thì mọi hồ sơ đã khép từ đời nào vẫn nằm mãi
      // trong ô này — con số chỉ có tăng, không bao giờ giảm. `convertedAt` là mốc do
      // chính lượt convert ghi, tách được hai nhóm đó; groupBy theo status thì không.
      sdb.lead.count({
        where: {
          deletedAt: null,
          status: { notIn: LEAD_CLOSED_STATUSES },
          convertedAt: null,
        },
      }),
    ]);

  const statusCount = new Map<string, number>();
  let total = 0;
  let enrolledTotal = 0;
  for (const g of byStatus) {
    const c = g._count._all;
    statusCount.set(g.status, c);
    total += c;
    if (g.status === "DA_DANG_KY") enrolledTotal += c;
  }

  // GĐ5 — mẫu số nay là TOÀN BỘ lead. Trước đây phải trừ nhóm DUPLICATE ra khỏi mẫu
  // để tỉ lệ chuyển đổi không bị lead trùng làm loãng; enum mới không còn giá trị đó
  // vì việc chống trùng đã dời lên ràng buộc lúc TẠO lead, nên không còn nhóm nào để
  // trừ. Không được thay bằng "trừ DA_MAT": lead mất là kết quả tư vấn thật, phải nằm
  // trong mẫu số, khác hẳn bản ghi trùng vốn không phải một khách hàng riêng.
  const conversion = total > 0 ? (enrolledTotal / total) * 100 : 0;

  const funnelData = FUNNEL_STAGES.map((stage) => ({
    name: stage.name,
    value: stage.statuses.reduce((sum, s) => sum + (statusCount.get(s) ?? 0), 0),
  }));

  const sourceData = bySource
    .map((g) => ({ source: g.source ?? "Không rõ", count: g._count._all }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);

  const assignedMap = new Map(
    byAssigned.map((g) => [g.assignedToId, g._count._all]),
  );
  const enrolledMap = new Map(
    enrolledByAssigned.map((g) => [g.assignedToId, g._count._all]),
  );
  const salesRows = sales
    .map((u) => {
      const assigned = assignedMap.get(u.id) ?? 0;
      const enrolled = enrolledMap.get(u.id) ?? 0;
      return {
        id: u.id,
        name: u.name ?? u.email,
        assigned,
        enrolled,
        rate: assigned > 0 ? (enrolled / assigned) * 100 : 0,
      };
    })
    .sort((a, b) => b.enrolled - a.enrolled);

  return (
    <div className="max-w-6xl p-6">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold text-foreground">CRM Dashboard</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Phễu chuyển đổi lead & hiệu suất đội sale.
          </p>
        </div>
        <Link
          href="/leads?view=kanban"
          className="rounded-lg border border-border px-3 py-2 text-sm font-medium text-foreground hover:bg-muted"
        >
          Mở Kanban Leads →
        </Link>
      </div>

      {/* KPI cards */}
      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCardAdmin
          label="Lead tháng này"
          value={monthTotal}
          icon={<Users className="h-5 w-5" />}
        />
        <StatCardAdmin
          label="Đang xử lý"
          value={open}
          icon={<Loader2 className="h-5 w-5" />}
          iconColor="neutral"
        />
        <StatCardAdmin
          label="Chốt tháng này"
          value={monthEnrolled}
          icon={<CheckCircle2 className="h-5 w-5" />}
          iconColor="purple"
        />
        <StatCardAdmin
          label="Tỉ lệ chuyển đổi"
          value={`${conversion.toFixed(1)}%`}
          icon={<Percent className="h-5 w-5" />}
          iconColor="purple"
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Funnel */}
        <div className="rounded-xl border border-border bg-card p-4">
          <h2 className="mb-2 text-sm font-semibold text-foreground">
            Phễu chuyển đổi
          </h2>
          {total === 0 ? (
            <EmptyChart />
          ) : (
            <FunnelChart data={funnelData} height={300} />
          )}
        </div>

        {/* Source */}
        <div className="rounded-xl border border-border bg-card p-4">
          <h2 className="mb-2 text-sm font-semibold text-foreground">
            Lead theo nguồn
          </h2>
          {sourceData.length === 0 ? (
            <EmptyChart />
          ) : (
            <BarChart
              data={sourceData}
              xKey="source"
              bars={[{ key: "count", name: "Số lead" }]}
              height={300}
            />
          )}
        </div>
      </div>

      {/* Sale performance */}
      <div className="mt-6 rounded-xl border border-border bg-card p-4">
        <h2 className="mb-3 text-sm font-semibold text-foreground">
          Hiệu suất đội sale
        </h2>
        {salesRows.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            Chưa có nhân viên SALES_CSM.
          </p>
        ) : (
          <PhanTrangBang cuonNgang>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="py-2 pr-4 font-semibold">Nhân viên</th>
                  <th className="py-2 pr-4 font-semibold">Lead được giao</th>
                  <th className="py-2 pr-4 font-semibold">Đã chốt</th>
                  <th className="py-2 font-semibold">Tỉ lệ chốt</th>
                </tr>
              </thead>
              <tbody>
                {salesRows.map((r) => (
                  <tr key={r.id} className="border-b border-border">
                    <td className="py-2 pr-4 font-medium text-foreground">
                      {r.name}
                    </td>
                    <td className="py-2 pr-4 text-foreground">{r.assigned}</td>
                    <td className="py-2 pr-4 text-foreground">{r.enrolled}</td>
                    <td className="py-2 text-foreground">{r.rate.toFixed(1)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </PhanTrangBang>
        )}
      </div>

      {/* Status breakdown chips */}
      <div className="mt-6 rounded-xl border border-border bg-card p-4">
        <h2 className="mb-3 text-sm font-semibold text-foreground">
          Chi tiết theo trạng thái
        </h2>
        <div className="flex flex-wrap gap-2">
          {[...statusCount.entries()]
            .sort((a, b) => b[1] - a[1])
            .map(([status, count]) => (
              <span
                key={status}
                className="rounded-full bg-muted px-3 py-1 text-xs font-medium text-foreground"
              >
                {LEAD_STATUS_LABEL[status as LeadStatus] ?? status}: {count}
              </span>
            ))}
        </div>
      </div>
    </div>
  );
}

function EmptyChart() {
  return (
    <div className="flex h-[300px] items-center justify-center text-sm text-muted-foreground">
      Chưa có dữ liệu.
    </div>
  );
}
