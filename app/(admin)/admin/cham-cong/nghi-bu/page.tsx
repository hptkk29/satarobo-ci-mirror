// app/(admin)/admin/cham-cong/nghi-bu/page.tsx — QUỸ NGHỈ BÙ theo khối (đợt 8 đơn từ, BA 4.11 + 5.1).
//
// Một bảng: người có ca ở khối (tháng này + tháng trước) × số dư / đã cộng / đã dùng, kèm lịch sử biến
// động gần nhất. Điều chỉnh tay (MANUAL_ADJUSTMENT) chỉ hiện khi có `hr_attendance:adjust` ở khối —
// cùng cổng action kiểm (luật 12: nút hiện ⇔ bấm được).
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { resolveActor } from "@/lib/auth/actor";
import { scopedDb } from "@/lib/db-scope";
import { ASK_WHO, loadModuleScope, type ModuleAction } from "@/lib/cham-cong/module-scope";
import { lichSuQuy, ngayCanRaSoat, soDuQuyCuaNguoi } from "@/lib/cham-cong/nghi-bu-db";
import { hrefWith } from "@/lib/cham-cong/scope-href";
import { nhanPhut } from "@/lib/cham-cong/dong-phut-don";
import { vnAddDays, vnDateOnly, vnYmd } from "@/lib/time/vn";
import { PageHeader } from "@/components/admin/ui/page-header";
import { EmptyState, NoPermission } from "@/components/admin/ui/states";
import { ModuleNav } from "@/components/admin/cham-cong/module-nav";
import { ScopeBar } from "@/components/admin/cham-cong/scope-bar";
import { SectionCard } from "@/components/admin/cham-cong/section-card";
import { BangQuyNghiBu, type DongBangQuy } from "./_components/bang-quy-nghi-bu";

export const metadata = { title: "Quỹ nghỉ bù | Admin", robots: { index: false } };
export const dynamic = "force-dynamic";

const VIEW: ModuleAction = "hr_attendance:view";
const ADJUST: ModuleAction = "hr_attendance:adjust";
const BASE = "/cham-cong/nghi-bu";

const NHAN_NGUON: Record<string, string> = {
  APPROVED_OT: "Tăng ca quy đổi",
  HOLIDAY_WORK: "Làm ngày nghỉ / lễ",
  MANUAL_ADJUSTMENT: "Điều chỉnh tay",
  COMP_LEAVE: "Dùng nghỉ bù",
  COMP_LEAVE_REFUND: "Hoàn do huỷ đơn",
};

export default async function NghiBuPage({ searchParams }: { searchParams: Promise<{ coSo?: string }> }) {
  const session = await auth();
  if (!session?.user) redirect("/login?callbackUrl=%2Fcham-cong%2Fnghi-bu");
  const sp = await searchParams;
  const scope = await loadModuleScope(session.user.id);
  const visible = scope.blocksWith(VIEW);
  if (visible.length === 0) {
    return (
      <div className="max-w-6xl">
        <PageHeader title="Quỹ nghỉ bù" />
        <ModuleNav active="nghibu" scope={scope} ctx={{ coSo: sp.coSo ?? null }} />
        <NoPermission permission={VIEW} what="quỹ nghỉ bù" askWho={ASK_WHO[VIEW]} />
      </div>
    );
  }
  const block = scope.pick(sp.coSo, VIEW) ?? visible[0];
  const coSo = block.id;
  const dieuChinhDuoc = scope.has(ADJUST, coSo);

  const sdb = scopedDb(await resolveActor(session.user.id));
  const now = new Date();
  const tu = vnDateOnly(vnAddDays(now, -60));
  const caGanDay = await sdb.shiftAssignment.findMany({
    where: { centerId: coSo, workDate: { gte: tu } },
    select: { userId: true },
    distinct: ["userId"],
  });
  const userIds = caGanDay.map((c) => c.userId);
  const [users, quy, lichSu, raSoat] = await Promise.all([
    userIds.length
      ? sdb.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true, email: true } })
      : Promise.resolve([]),
    soDuQuyCuaNguoi(userIds),
    lichSuQuy(userIds, 30),
    ngayCanRaSoat(userIds),
  ]);
  const ten = new Map(users.map((u) => [u.id, u.name ?? u.email ?? u.id]));
  const dong: DongBangQuy[] = userIds
    .map((id) => {
      const q = quy.get(id)!;
      return { userId: id, ten: ten.get(id) ?? id, soDu: q.soDu < 0 ? `−${nhanPhut(-q.soDu)}` : nhanPhut(q.soDu), soDuPhut: q.soDu, congThem: nhanPhut(q.congThem), daDung: nhanPhut(q.daDung) };
    })
    .sort((a, b) => b.soDuPhut - a.soDuPhut || a.ten.localeCompare(b.ten, "vi"));

  return (
    <div className="max-w-6xl">
      <PageHeader
        title="Quỹ nghỉ bù"
        subtitle="Số phút nghỉ bù tích luỹ của từng người. Quỹ không bao giờ âm: duyệt nghỉ bù, điều chỉnh trừ hay huỷ đơn tăng ca chỉ được khi quỹ đủ; khi tính lại công cần trừ lại phần người đó đã nghỉ bù, ngày ấy vào mục “Cần rà soát” thay vì trừ âm."
      />
      <ModuleNav active="nghibu" scope={scope} ctx={{ coSo }} />
      <ScopeBar basePath={BASE} blocks={visible.map((b) => ({ id: b.id, label: b.label }))} coSo={coSo} />
      {dong.length === 0 ? (
        <EmptyState title="Chưa có ai" description="Khối này chưa có người được xếp ca trong 60 ngày gần đây." />
      ) : (
        <SectionCard title={`Số dư quỹ — ${block.label}`}>
          <BangQuyNghiBu coSo={coSo} dong={dong} dieuChinhDuoc={dieuChinhDuoc} />
        </SectionCard>
      )}
      {raSoat.length > 0 && (
        <SectionCard title={`Cần rà soát (${raSoat.length})`}>
          <p className="mb-2 text-sm text-muted-foreground">
            Tính lại công muốn trừ lại phút đã cộng vào quỹ (giờ tăng ca / làm ngày nghỉ thật ít hơn), nhưng người đó đã
            nghỉ bù bằng phần ấy nên hệ thống KHÔNG trừ (quỹ sẽ âm) và cũng không bỏ qua. Khi quỹ đủ, tính lại ngày đó sẽ
            tự trừ nốt; hoặc xử lý bằng điều chỉnh tay kèm lý do.
          </p>
          <ul className="divide-y divide-border text-sm">
            {raSoat.map((r) => (
              <li key={`${r.userId}-${r.workDate.toISOString()}`} className="flex flex-wrap items-baseline justify-between gap-2 py-2">
                <span className="min-w-0">
                  <span className="font-medium text-foreground">{ten.get(r.userId) ?? r.userId}</span>
                  <span className="text-muted-foreground">
                    {" · chưa trừ "}
                    {r.treo.map((t) => `${nhanPhut(t.phut)} (${NHAN_NGUON[t.nguon] ?? t.nguon})`).join(", ") || "—"}
                  </span>
                </span>
                <a
                  href={hrefWith("/cham-cong", { coSo, date: vnYmd(new Date(r.workDate.getTime() + 12 * 3_600_000)) })}
                  className="shrink-0 text-xs font-semibold text-primary underline-offset-2 hover:underline"
                >
                  Ngày {vnYmd(new Date(r.workDate.getTime() + 12 * 3_600_000))}
                </a>
              </li>
            ))}
          </ul>
        </SectionCard>
      )}
      {lichSu.length > 0 && (
        <SectionCard title="Biến động gần đây">
          <ul className="divide-y divide-border text-sm">
            {lichSu.map((r) => (
              <li key={r.id} className="flex flex-wrap items-baseline justify-between gap-2 py-2">
                <span className="min-w-0">
                  <span className="font-medium text-foreground">{ten.get(r.userId) ?? r.userId}</span>
                  <span className="text-muted-foreground"> · {NHAN_NGUON[r.sourceType] ?? r.sourceType}</span>
                  {r.note ? <span className="text-muted-foreground"> — {r.note}</span> : null}
                </span>
                <span className="flex shrink-0 items-baseline gap-3">
                  <span className="text-xs text-muted-foreground tabular-nums">{vnYmd(r.createdAt)}</span>
                  <b className={r.minutes >= 0 ? "text-state-success-ink tabular-nums" : "text-state-danger-ink tabular-nums"}>
                    {r.minutes >= 0 ? "+" : "−"}
                    {nhanPhut(Math.abs(r.minutes))}
                  </b>
                </span>
              </li>
            ))}
          </ul>
        </SectionCard>
      )}
    </div>
  );
}
