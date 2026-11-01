import Link from "next/link";
import { safeCache } from "@/lib/cache/safe-cache";
import { Wallet, AlertTriangle, TrendingUp } from "lucide-react";
import { scopedDb } from "@/lib/db-scope";
// R-13 — DÙNG LẠI bộ tổng hợp của /bao-cao/trung-tam, không viết công thức thứ 8.
import { summarizeFinance, revenueByCenter } from "@/lib/reports/trung-tam";
import type { Actor } from "@/lib/auth/actor";
import { CACHE_TAGS } from "@/lib/cache/tags";
import { actorScopeKey } from "@/lib/cache/scope-key";

// ⚠️ R-13 (13/09/2026) — GỠ `PAID_STATUSES`.
//
// Trước bản vá, CẢ NĂM con số tiền của màn này suy từ `Order.totalAmount` + `Order.status`,
// KHÔNG chạm bảng `Payment` một lần nào. Công thức đó đúng bằng `paidOf`
// (`lib/finance/debt.ts:14-16` — "status ∈ {CONFIRMED,COMPLETED} ⇒ đã trả TOÀN BỘ"), mà
// chính repo đã ghi là thứ KHÔNG màn hình nào nên dùng (`scripts/shadow-compare-debt.ts:16-18`).
//
// Hệ quả: đơn đóng 90% vẫn bị tính nợ 100%; đơn CONFIRMED mà chưa ghi đủ khoản thì nợ = 0;
// và màn Công nợ (`getDebtRows`) không bao giờ khớp được với màn này. Sắp tới có CỌC thì
// sai nặng hơn — đóng 500.000đ mà ô "Đã thu" cộng đủ 7.920.000đ.
//
// Nay dùng lại ĐÚNG bộ tổng hợp đang chạy ở `/bao-cao/trung-tam`
// (`lib/reports/trung-tam.ts` — thuần, có unit test, đã vá mù REFUNDED/ADJUSTED cùng lượt).
// KHÔNG viết công thức mới: hệ đã có ≥7 định nghĩa "đã thu", thêm một cái nữa là thành 8.

function vnd(n: number): string {
  return `${n.toLocaleString("vi-VN")}đ`;
}

// Đợt 3C — Dashboard KẾ TOÁN. Tài chính toàn hệ thống. KHÔNG pipeline/điểm danh/giáo trình.
// REQ-04: số liệu tài chính dashboard kế toán (aggregate theo scope → PRIMITIVE, tên cơ
// sở resolve sẵn, KHÔNG Map/Date trong output → serialize an toàn).
async function getAccountantStats(actor: Actor) {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const overdueBefore = new Date(now.getTime() - 7 * 86400000); // PENDING_PAYMENT > 7 ngày

  // FL0 — cách ly cơ sở: Order + Payment ∈ SCOPED_MODELS → scopedDb lọc theo tầm nhìn.
  // `aggregate`/`groupBy`/`findMany` đều nằm trong 7 method được bọc (`lib/db-scope.ts`).
  const sdb = scopedDb(actor);
  const [paymentRows, enrollmentRows, overdueOrders, centers] = await Promise.all([
    // R-13 — ĐỌC SỔ TIỀN. `id` + `adjustmentOfId` bắt buộc: thiếu chúng thì khoản đã bị
    // ĐIỀU CHỈNH vẫn được đếm bằng số CŨ (xem `lib/reports/trung-tam.ts`).
    sdb.payment.findMany({
      where: { deletedAt: null },
      select: {
        id: true,
        centerId: true,
        amount: true,
        accountantStatus: true,
        paidDate: true,
        adjustmentOfId: true,
      },
      take: 5000,
    }),
    // Phải thu bám GHI DANH (`Enrollment.finalPrice`) — cùng nguồn với `/bao-cao/trung-tam`.
    // Enrollment KHÔNG thuộc SCOPED_MODELS nên lọc theo lớp đã scope, không lọc thẳng.
    sdb.class
      .findMany({ select: { id: true, centerId: true } })
      .then(async (classes) => {
        const byClass = new Map(classes.map((c) => [c.id, c.centerId]));
        // `sdb` chứ không phải `db` trần: ESLint R6-F1 chặn, và `Enrollment` KHÔNG
        // thuộc SCOPED_MODELS nên cách ly cơ sở đã được ép TAY bằng `classId in byClass`.
        const rows = await sdb.enrollment.findMany({
          where: { deletedAt: null, classId: { in: [...byClass.keys()] } },
          select: { studentId: true, classId: true, finalPrice: true, tuition: true, enrolledAt: true },
          take: 5000,
        });
        return rows.map((e) => ({
          studentId: e.studentId,
          centerId: byClass.get(e.classId) ?? null,
          finalPrice: e.finalPrice,
          tuition: e.tuition,
          enrolledAt: e.enrolledAt,
        }));
      }),
    sdb.order.findMany({
      where: { status: "PENDING_PAYMENT", createdAt: { lt: overdueBefore } },
      orderBy: { createdAt: "asc" },
      take: 12,
      select: {
        id: true, totalAmount: true,
        student: { select: { name: true } },
        center: { select: { name: true } },
      },
    }),
    sdb.center.findMany({ select: { id: true, name: true } }),
  ]);

  const centerName = new Map(centers.map((c) => [c.id, c.name]));
  const finance = summarizeFinance(paymentRows, enrollmentRows);
  const byCenter = revenueByCenter(paymentRows, enrollmentRows);
  const thangNay = paymentRows.filter((p) => p.paidDate >= monthStart);
  return {
    paid: finance.confirmedRevenue,
    debt: finance.debt,
    revenueMonth: summarizeFinance(thangNay, []).confirmedRevenue,
    debtByCenter: byCenter
      .filter((c) => c.debt > 0)
      .map((c) => ({
        label: c.centerId === "—" ? "Chưa gán cơ sở" : centerName.get(c.centerId) ?? "—",
        amount: c.debt,
      })),
    overdueOrders: overdueOrders.map((o) => ({
      id: o.id,
      studentName: o.student?.name ?? "—",
      centerName: o.center?.name ?? "",
      amount: o.totalAmount,
    })),
  };
}

export async function AccountantDashboard({ name, actor, embedded = false }: { name: string; actor: Actor; embedded?: boolean }) {
  // REQ-04: cache theo scope, TTL 60s. Output primitive (tên resolve sẵn).
  const { paid, debt, revenueMonth, debtByCenter, overdueOrders } = await safeCache(
    () => getAccountantStats(actor),
    ["accountant-dashboard-stats", actorScopeKey(actor)],
    { tags: [CACHE_TAGS.dashboard], revalidate: 60 },
  )();

  return (
    <div className="space-y-6">
      {!embedded && <h1 className="text-2xl font-bold text-foreground">Chào {name || "bạn"} 👋 · Tài chính</h1>}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatBig label="Đã thu (tổng)" value={vnd(paid)} tone="ok" icon={<Wallet className="h-5 w-5" />} />
        <StatBig label="Còn nợ (chờ thanh toán)" value={vnd(debt)} tone={debt > 0 ? "danger" : "ok"} icon={<AlertTriangle className="h-5 w-5" />} />
        <StatBig label="Doanh thu tháng này" value={vnd(revenueMonth)} tone="neutral" icon={<TrendingUp className="h-5 w-5" />} />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Công nợ theo cơ sở */}
        <section className="rounded-xl border border-border bg-card p-5">
          <h2 className="mb-3 text-sm font-bold uppercase tracking-wider text-muted-foreground">Công nợ theo cơ sở</h2>
          {debtByCenter.length === 0 ? (
            <p className="text-sm text-muted-foreground">Không có công nợ.</p>
          ) : (
            <ul className="space-y-1.5 text-sm">
              {debtByCenter.map((d, i) => (
                <li key={i} className="flex items-center justify-between">
                  <span className="text-foreground">{d.label}</span>
                  <span className="font-semibold tabular-nums text-state-danger-ink">{vnd(d.amount)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Hoá đơn quá hạn */}
        <section className="rounded-xl border border-border bg-card p-5">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-muted-foreground">
            <AlertTriangle className="h-4 w-4 text-state-danger-ink" /> Hoá đơn quá hạn (&gt;7 ngày chưa thu)
          </h2>
          {overdueOrders.length === 0 ? (
            <p className="text-sm text-muted-foreground">Không có hoá đơn quá hạn.</p>
          ) : (
            <ul className="space-y-1.5 text-sm">
              {overdueOrders.map((o) => (
                <li key={o.id} className="flex items-center justify-between gap-2">
                  <Link href={`/orders/${o.id}`} className="truncate text-foreground hover:text-primary">
                    {o.studentName}
                    <span className="ml-1 text-xs text-muted-foreground">{o.centerName}</span>
                  </Link>
                  <span className="shrink-0 font-semibold tabular-nums text-state-danger-ink">{vnd(o.amount)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <Link href="/orders" className="inline-block text-sm font-semibold text-primary hover:underline">
        Quản lý đơn hàng / học phí →
      </Link>
    </div>
  );
}

function StatBig({
  label, value, tone, icon,
}: {
  label: string; value: string; tone: "neutral" | "ok" | "danger"; icon: React.ReactNode;
}) {
  const toneCls = tone === "danger" ? "text-state-danger-ink" : tone === "ok" ? "text-state-success-ink" : "text-primary";
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className={`flex items-center gap-2 ${toneCls}`}>{icon}<span className="text-xl font-bold tabular-nums">{value}</span></div>
      <div className="mt-1 text-xs text-muted-foreground">{label}</div>
    </div>
  );
}
