import { redirect } from "next/navigation";
import { TrendingUp } from "lucide-react";
import { auth } from "@/lib/auth";
import { checkPermission } from "@/lib/auth/check-permission";
import { resolveActor } from "@/lib/auth/actor";
import { getModelVisibleCenterIds } from "@/lib/db-scope";
import { getFunnelCounts } from "@/lib/crm/funnel-query";
import { computeFunnelMetrics } from "@/lib/crm/marketing-metrics";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const dynamic = "force-dynamic";
export const metadata = { title: "Funnel Marketing | Admin" };

const vnd = (n: number) => Math.round(n).toLocaleString("vi-VN");

export default async function MarketingFunnelPage() {
  const session = await auth();
  if (!(await checkPermission("leads:view-all"))) redirect("/admin/dashboard");

  // C8.3 + vá 24/07 — per-model scope thay isHoLevel trần: cross-center chỉ khi actor
  // có quyền leads:* scope ALL (SUPER_ADMIN/HO-marketing giữ nguyên; HO-role khác
  // chức năng — vd TRAINING@HO — về đúng cơ sở mình).
  const actor = await resolveActor(session!.user.id);
  const scope = getModelVisibleCenterIds("Lead", actor);
  const centerIds = scope === "ALL" ? undefined : scope;
  const counts = await getFunnelCounts({ centerIds });
  const m = computeFunnelMetrics(counts);

  const cards: { label: string; value: string }[] = [
    { label: "L1 (hội thoại)", value: counts.l1.toLocaleString("vi-VN") },
    { label: "L2 (đạt SĐT)", value: counts.l2.toLocaleString("vi-VN") },
    { label: "L3 (chốt)", value: counts.l3.toLocaleString("vi-VN") },
    { label: "CR L1→L2", value: `${(m.crL1L2 * 100).toFixed(1)}%` },
    { label: "CR L2→L3", value: `${(m.crL2L3 * 100).toFixed(1)}%` },
    { label: "Chi phí QC", value: vnd(counts.spend) },
    { label: "CPL", value: vnd(m.cpl) },
    { label: "CPA", value: vnd(m.cpa) },
    { label: "ROAS", value: m.roas.toFixed(2) },
  ];

  return (
    <div>
      <h1 className="mb-6 flex items-center gap-2 text-3xl font-black text-foreground">
        <TrendingUp className="h-7 w-7 text-primary" />
        Funnel Marketing
      </h1>
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
        {cards.map((c) => (
          <Card key={c.label}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">{c.label}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-black text-foreground">{c.value}</div>
            </CardContent>
          </Card>
        ))}
      </div>
      <p className="mt-4 text-xs text-muted-foreground">
        ROAS = doanh thu (đơn CONFIRMED/COMPLETED) / chi phí QC.
      </p>
    </div>
  );
}
