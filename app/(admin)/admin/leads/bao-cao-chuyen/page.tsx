import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeftRight } from "lucide-react";
import { auth } from "@/lib/auth";
import { checkPermission, canViewLeadPii } from "@/lib/auth/check-permission";
import { maskLeadPiiFields } from "@/lib/lead/pii";
import { getModelVisibleCenterIds, scopedDb, logScopeBypass } from "@/lib/db-scope";
import { resolveActor } from "@/lib/auth/actor";
import type { Prisma } from "@prisma/client";
import { formatDateVN } from "@/lib/format/date";
import { PhanTrangBang } from "@/components/ui/phan-trang-bang";
import { CONVERTED_STATUSES } from "@/lib/leads/status";
import { formatPhoneVN } from "@/lib/phone";

export const metadata = { title: "Báo cáo chuyển lead liên cơ sở | Admin" };
export const dynamic = "force-dynamic";

// "Kết quả = Đã chốt" của lead sau khi chuyển cơ sở.
// ⚠️ Trước đây là `new Set(["ENROLLED"])` chép tay: Set<string> nên tsc KHÔNG đỏ khi
// enum đổi ở GĐ5, cột "Đã chốt" cứ đứng 0/N. Dùng thẳng nguồn duy nhất.
const CLOSED_STATUSES = CONVERTED_STATUSES;

interface Props {
  searchParams: Promise<{ month?: string }>;
}

export default async function TransferReportPage({ searchParams }: Props) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!(await checkPermission("leads:assign"))) redirect("/leads");

  // Cách ly cơ sở: LeadTransfer KHÔNG ∈ SCOPED_MODELS (có from/toCenterId, không 1
  // centerId trực tiếp) → scopedDb không auto-scope. Scope THỦ CÔNG theo tầm nhìn cơ
  // sở của model Lead (đọc động từ actor/UserOrgRole, không phụ thuộc session.centerId
  // cũ): CM@CS1 chỉ thấy transfer vào/ra CS1; SUPER_ADMIN/HO (ALL) thấy toàn hệ thống.
  const actor = await resolveActor(session.user.id);
  const sdb = scopedDb(actor);
  const visibleCenters = getModelVisibleCenterIds("Lead", actor);
  const isAll = visibleCenters === "ALL";

  const sp = await searchParams;
  const now = new Date();
  const month =
    sp.month && /^\d{4}-\d{2}$/.test(sp.month)
      ? sp.month
      : `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const year = Number(month.slice(0, 4));
  const monthIdx = Number(month.slice(5, 7)) - 1;
  const monthStart = new Date(year, monthIdx, 1);
  const monthEnd = new Date(year, monthIdx + 1, 1);

  // Chỉ chuyển LIÊN CƠ SỞ (from != to, đều có giá trị).
  const where: Prisma.LeadTransferWhereInput = {
    createdAt: { gte: monthStart, lt: monthEnd },
    fromCenterId: { not: null },
    toCenterId: { not: null },
    ...(visibleCenters === "ALL"
      ? {}
      : {
          OR: [
            { fromCenterId: { in: visibleCenters } },
            { toCenterId: { in: visibleCenters } },
          ],
        }),
  };

  const transfersRaw = await sdb.leadTransfer.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: 500,
  });
  // Loại các bản ghi from==to (phòng khi DB field-compare không khả dụng).
  const transfers = transfersRaw.filter((t) => t.fromCenterId !== t.toCenterId);

  const centerIds = [
    ...new Set(transfers.flatMap((t) => [t.fromCenterId, t.toCenterId].filter((x): x is string => !!x))),
  ];
  const leadIds = [...new Set(transfers.map((t) => t.leadId))];

  // Lead hiển thị: leadIds đến từ transfer ĐÃ scope tay ở trên (vào/ra cơ sở mình).
  // Lead chuyển ĐI hiện thuộc cơ sở khác → sdb.lead sẽ ẩn, trong khi báo cáo cần
  // thấy kết quả "đã chốt" của lead mình chuyển đi → bypass HẸP cho đúng 1 truy vấn
  // này (select tối thiểu, key từ transfer đã scope) + ghi audit bypass (AC10).
  const leadReadDb = isAll ? sdb : scopedDb(actor, { bypass: true });
  if (!isAll && leadIds.length) {
    await logScopeBypass(
      actor,
      "bao-cao-chuyen: đọc tên/trạng thái lead đã chuyển đi khỏi cơ sở (báo cáo liên cơ sở)",
    );
  }
  const [centers, leads] = await Promise.all([
    centerIds.length
      ? sdb.center.findMany({ where: { id: { in: centerIds } }, select: { id: true, name: true, code: true } })
      : Promise.resolve([]),
    leadIds.length
      ? leadReadDb.lead.findMany({ where: { id: { in: leadIds } }, select: { id: true, parentName: true, phone: true, status: true } })
      : Promise.resolve([]),
  ]);
  const centerMap = new Map(centers.map((c) => [c.id, c]));
  // S-1 — cổng vào màn này là `leads:assign` (SUPER_ADMIN + Quản lý cơ sở), mà QL
  // cơ sở KHÔNG còn `leads:view-pii` từ Q9. Che ngay khi dựng bảng tra, không phải
  // ở JSX: dữ liệu che ở JSX vẫn đi trọn vẹn xuống trình duyệt trong payload RSC.
  const canViewPii = await canViewLeadPii();
  const leadMap = new Map(
    leads.map((l) => [l.id, maskLeadPiiFields(l, canViewPii)] as const),
  );

  const rows = transfers.map((t) => {
    const lead = leadMap.get(t.leadId);
    return {
      id: t.id,
      leadId: t.leadId,
      parentName: lead?.parentName ?? "(đã xoá)",
      phone: lead?.phone ?? "",
      from: centerMap.get(t.fromCenterId ?? "")?.code ?? centerMap.get(t.fromCenterId ?? "")?.name ?? "—",
      to: centerMap.get(t.toCenterId ?? "")?.code ?? centerMap.get(t.toCenterId ?? "")?.name ?? "—",
      by: t.transferredByName,
      reason: t.reason ?? t.note,
      closed: lead ? CLOSED_STATUSES.has(lead.status) : false,
      createdAt: t.createdAt.toISOString(),
    };
  });

  const total = rows.length;
  const closedCount = rows.filter((r) => r.closed).length;
  // Thống kê theo hướng chuyển động — không hardcode CS1/CS2 (CS3/CS4 tự gộp).
  const dirCounts = new Map<string, number>();
  for (const r of rows) {
    if (r.from === "—" || r.to === "—" || r.from === r.to) continue;
    const key = `${r.from} → ${r.to}`;
    dirCounts.set(key, (dirCounts.get(key) ?? 0) + 1);
  }
  const topDirections = [...dirCounts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 2);

  const prevM = new Date(year, monthIdx - 1, 1);
  const nextM = new Date(year, monthIdx + 1, 1);
  const mStr = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;

  return (
    <div className="max-w-5xl p-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-foreground">
            <ArrowLeftRight className="h-6 w-6 text-primary" /> Chuyển lead liên cơ sở
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {isAll ? "Toàn hệ thống" : "Lead vào/ra cơ sở của bạn"} · tháng {month}
          </p>
        </div>
        <div className="flex items-center gap-2 text-sm">
          {/* `scroll={false}`: lùi/tiến tháng chỉ đổi `?month=` của chính trang này —
              để Next cuộn lên đầu thì mỗi lần đổi tháng người xem lại phải cuộn xuống
              đúng chỗ bảng vừa nhìn. */}
          <Link href={`/leads/bao-cao-chuyen?month=${mStr(prevM)}`} scroll={false} className="rounded-lg border border-border px-2 py-1.5 hover:bg-muted">←</Link>
          <span className="font-semibold text-foreground">{month}</span>
          <Link href={`/leads/bao-cao-chuyen?month=${mStr(nextM)}`} scroll={false} className="rounded-lg border border-border px-2 py-1.5 hover:bg-muted">→</Link>
        </div>
      </div>

      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Tổng chuyển" value={total} />
        {topDirections.map(([dir, count]) => (
          <Stat key={dir} label={dir} value={count} />
        ))}
        <Stat label="Đã chốt" value={`${closedCount}/${total}`} tone="ok" />
      </div>

      {rows.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
          Không có lead chuyển liên cơ sở trong tháng này.
        </p>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border bg-card">
          <PhanTrangBang cuonNgang>
            <table className="min-w-full text-sm">
              <thead className="border-b border-border bg-muted text-left text-xs uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="px-3 py-2">Lead</th>
                  <th className="px-3 py-2">Chuyển</th>
                  <th className="px-3 py-2">Người chuyển</th>
                  <th className="px-3 py-2">Lý do / bàn giao</th>
                  <th className="px-3 py-2">Kết quả</th>
                  <th className="px-3 py-2">Ngày</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-b border-border last:border-0">
                    <td className="px-3 py-2">
                      <Link href={`/leads/${r.leadId}`} className="font-medium text-primary hover:underline">
                        {r.parentName}
                      </Link>
                      <span className="block text-xs text-muted-foreground">{formatPhoneVN(r.phone)}</span>
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap font-semibold text-foreground">
                      {r.from} → {r.to}
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">{r.by}</td>
                    <td className="px-3 py-2 max-w-xs truncate text-muted-foreground" title={r.reason}>{r.reason}</td>
                    <td className="px-3 py-2">
                      {r.closed ? (
                        <span className="rounded bg-state-success-soft px-2 py-0.5 text-xs font-semibold text-state-success-ink">Đã chốt</span>
                      ) : (
                        <span className="rounded bg-muted px-2 py-0.5 text-xs font-semibold text-muted-foreground">Chưa</span>
                      )}
                    </td>
                    <td className="px-3 py-2 tabular-nums text-muted-foreground">
                      {formatDateVN(r.createdAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </PhanTrangBang>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number | string; tone?: "ok" }) {
  return (
    <div className="rounded-xl border border-border bg-card p-3">
      <div className={`text-2xl font-bold tabular-nums ${tone === "ok" ? "text-state-success-ink" : "text-primary"}`}>{value}</div>
      <div className="mt-0.5 text-xs text-muted-foreground">{label}</div>
    </div>
  );
}
