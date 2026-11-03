import Link from "next/link";
import { redirect } from "next/navigation";
import { Coins, Search } from "lucide-react";
import type { Prisma } from "@prisma/client";
import { auth } from "@/lib/auth";
import { checkPermission } from "@/lib/auth/check-permission";
import { scopedDb, getModelVisibleCenterIds } from "@/lib/db-scope";
import { resolveActor } from "@/lib/auth/actor";
import { PageHeader } from "@/components/admin/ui/page-header";
import { adminTd, adminTh, adminTr } from "@/components/admin/ui/table";
import { DieuHuongTrangLink } from "@/components/ui/dieu-huong-trang-link";
import { formatDateVN } from "@/lib/format/date";
import { cn } from "@/lib/utils";
import { CapCoin } from "./_components/cap-coin";
import { QuyTacThuong } from "./_components/quy-tac";
import { NutDao } from "./_components/nut-dao";

export const metadata = { title: "SataCoin | Admin" };
export const dynamic = "force-dynamic";

// SataCoin (01/10/2026 — thiết kế lại theo yêu cầu chủ dự án). Bản cũ là 3 khối xếp dọc và
// KHÔNG có chỗ nào xem số dư của một bé — muốn biết phải tự cộng sổ cái 50 dòng gần nhất.
// Nay 4 tab: Số dư (mặc định) · Cấp coin · Quy tắc · Sổ cái. Số dư = tổng giao dịch (sổ cái
// bất biến), tính bằng groupBy qua scopedDb nên tự cắt theo tầm nhìn cơ sở.
//
// Tab là server component nhận `userId`, KHÔNG nhận `sdb` (bẫy dev "Invalid array length").

type Tab = "so-du" | "cap" | "quy-tac" | "so-cai";
const MOI_TRANG = 20;

const LOAI: Record<string, string> = { EARN: "Cộng", SPEND: "Trừ", ADJUST: "Điều chỉnh", REVERSAL: "Đảo" };
// reason là mã tự do — dịch mã phổ biến, còn lại giữ nguyên.
const LY_DO: Record<string, string> = {
  ATTENDANCE: "Điểm danh",
  REDEEM_GIFT: "Đổi quà",
  MANUAL: "Thủ công",
  ADJUSTMENT: "Điều chỉnh",
  REVERSAL: "Hoàn tác",
};

async function sdbCua(userId: string) {
  return scopedDb(await resolveActor(userId));
}

export default async function SataCoinPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; q?: string; page?: string; hv?: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!(await checkPermission("satacoin:manage"))) redirect("/dashboard");
  const sp = await searchParams;
  const tab: Tab =
    sp.tab === "cap" || sp.tab === "quy-tac" || sp.tab === "so-cai" ? sp.tab : "so-du";
  const q = sp.q?.trim() || undefined;
  const trang = Math.max(1, Number(sp.page) || 1);

  const sdb = await sdbCua(session.user.id);
  const tu30Ngay = new Date(Date.now() - 30 * 86_400_000);
  const [soDuTheoHv, gd30] = await Promise.all([
    sdb.sataCoinTransaction.groupBy({ by: ["studentId"], _sum: { amount: true } }),
    sdb.sataCoinTransaction.count({ where: { createdAt: { gte: tu30Ngay } } }),
  ]);
  const hvCoCoin = soDuTheoHv.filter((r) => (r._sum.amount ?? 0) > 0).length;
  const tongDangGiu = soDuTheoHv.reduce((s, r) => s + Math.max(0, r._sum.amount ?? 0), 0);

  const hrefTab = (k: Tab) => (k === "so-du" ? "/satacoin" : `/satacoin?tab=${k}`);

  return (
    <div>
      <PageHeader title="SataCoin" subtitle="Điểm thưởng nội bộ của học viên — sổ cái không sửa/xoá, sai thì đảo" />

      <dl className="mb-5 grid grid-cols-3 gap-3 sm:max-w-xl">
        {(
          [
            ["Coin học viên đang giữ", tongDangGiu],
            ["Học viên có coin", hvCoCoin],
            ["Giao dịch 30 ngày", gd30],
          ] as const
        ).map(([nhan, so]) => (
          <div key={nhan} className="rounded-xl border border-border bg-card px-4 py-3">
            <dd className="text-2xl font-semibold tabular-nums text-foreground">{so.toLocaleString("vi-VN")}</dd>
            <dt className="mt-0.5 text-xs text-muted-foreground">{nhan}</dt>
          </div>
        ))}
      </dl>

      <nav className="mb-4 flex gap-1 overflow-x-auto border-b border-border" aria-label="SataCoin">
        {(
          [
            ["so-du", "Số dư"],
            ["cap", "Cấp coin"],
            ["quy-tac", "Quy tắc thưởng"],
            ["so-cai", "Sổ cái"],
          ] as const
        ).map(([k, nhan]) => (
          <Link
            key={k}
            href={hrefTab(k)}
            aria-current={tab === k ? "page" : undefined}
            className={cn(
              "-mb-px inline-flex h-10 shrink-0 items-center border-b-2 px-3 text-sm font-medium transition-colors",
              tab === k
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {nhan}
          </Link>
        ))}
      </nav>

      {tab === "so-du" && (
        <TabSoDu userId={session.user.id} q={q} trang={trang} soDu={soDuTheoHv} />
      )}
      {tab === "cap" && <TabCap userId={session.user.id} hv={sp.hv ?? null} soDu={soDuTheoHv} />}
      {tab === "quy-tac" && <TabQuyTac userId={session.user.id} />}
      {tab === "so-cai" && <TabSoCai userId={session.user.id} q={q} trang={trang} />}
    </div>
  );
}

function OTim({ tab, q, goiY }: { tab: Tab; q: string | undefined; goiY: string }) {
  return (
    <form method="GET" className="mb-3 flex max-w-md items-center gap-2">
      {tab !== "so-du" && <input type="hidden" name="tab" value={tab} />}
      <label className="relative flex-1">
        <span className="sr-only">Tìm</span>
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <input
          name="q"
          defaultValue={q}
          placeholder={goiY}
          className="h-9 w-full rounded-lg border border-border bg-background pl-9 pr-3 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
        />
      </label>
      <button
        type="submit"
        className="inline-flex h-9 items-center rounded-lg border border-border bg-card px-4 text-sm font-semibold hover:bg-muted"
      >
        Tìm
      </button>
    </form>
  );
}

type SoDuRow = { studentId: string; _sum: { amount: number | null } };

async function TabSoDu({
  userId,
  q,
  trang,
  soDu,
}: {
  userId: string;
  q: string | undefined;
  trang: number;
  soDu: SoDuRow[];
}) {
  const sdb = await sdbCua(userId);
  const coGd = soDu.filter((r) => (r._sum.amount ?? 0) !== 0);
  const hocVien = coGd.length
    ? await sdb.student.findMany({
        where: {
          id: { in: coGd.map((r) => r.studentId) },
          deletedAt: null,
          ...(q ? { OR: [{ name: { contains: q, mode: "insensitive" } }, { studentCode: { contains: q, mode: "insensitive" } }] } : {}),
        },
        select: { id: true, name: true, studentCode: true, center: { select: { name: true } } },
      })
    : [];
  const soDuMap = new Map(coGd.map((r) => [r.studentId, r._sum.amount ?? 0]));
  const dong = hocVien
    .map((h) => ({ ...h, soDu: soDuMap.get(h.id) ?? 0 }))
    .sort((a, b) => b.soDu - a.soDu || a.name.localeCompare(b.name, "vi"));
  const soTrang = Math.max(1, Math.ceil(dong.length / MOI_TRANG));
  const t = Math.min(trang, soTrang);
  const trangNay = dong.slice((t - 1) * MOI_TRANG, t * MOI_TRANG);
  const href = (n: number) => {
    const p = new URLSearchParams();
    if (q) p.set("q", q);
    if (n > 1) p.set("page", String(n));
    const s = p.toString();
    return s ? `/satacoin?${s}` : "/satacoin";
  };

  return (
    <>
      <OTim tab="so-du" q={q} goiY="Tìm học viên / mã HV…" />
      {dong.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border px-6 py-12 text-center text-sm text-muted-foreground">
          {q ? `Không học viên nào khớp “${q}”.` : "Chưa học viên nào có giao dịch SataCoin."}
        </p>
      ) : (
        <>
          <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] text-sm">
                <thead className="bg-muted/40">
                  <tr>
                    <th className={adminTh}>Học viên</th>
                    <th className={adminTh}>Cơ sở</th>
                    <th className={cn(adminTh, "text-right")}>Số dư</th>
                    <th className={cn(adminTh, "text-right")}>Thao tác</th>
                  </tr>
                </thead>
                <tbody>
                  {trangNay.map((h) => (
                    <tr key={h.id} className={adminTr}>
                      <td className={adminTd}>
                        <p className="font-medium">{h.name}</p>
                        {h.studentCode && <p className="text-xs text-muted-foreground">{h.studentCode}</p>}
                      </td>
                      <td className={cn(adminTd, "text-muted-foreground")}>{h.center?.name ?? "—"}</td>
                      <td
                        className={cn(
                          adminTd,
                          "text-right text-base font-semibold tabular-nums",
                          h.soDu < 0 ? "text-state-danger-ink" : "text-foreground",
                        )}
                      >
                        <span className="inline-flex items-center gap-1">
                          <Coins className="size-4 text-state-warning-ink" aria-hidden />
                          {h.soDu.toLocaleString("vi-VN")}
                        </span>
                      </td>
                      <td className={cn(adminTd, "text-right")}>
                        <div className="inline-flex gap-1">
                          <Link
                            href={`/satacoin?tab=cap&hv=${h.id}`}
                            className="inline-flex h-8 items-center rounded-md border border-border px-2.5 text-xs font-semibold hover:bg-muted"
                          >
                            Cấp coin
                          </Link>
                          <Link
                            href={`/satacoin?tab=so-cai&q=${encodeURIComponent(h.name)}`}
                            className="inline-flex h-8 items-center rounded-md px-2.5 text-xs font-semibold text-muted-foreground hover:bg-muted hover:text-foreground"
                          >
                            Lịch sử
                          </Link>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <DieuHuongTrangLink className="mt-4" trang={t} soTrang={soTrang} hrefCua={href} />
        </>
      )}
    </>
  );
}

async function TabCap({ userId, hv, soDu }: { userId: string; hv: string | null; soDu: SoDuRow[] }) {
  const actor = await resolveActor(userId);
  const sdb = scopedDb(actor);
  // SataCoinRule là config (SCOPE_EXEMPT, centerId null = áp mọi cơ sở) → scope thủ công.
  const visibleCenters = getModelVisibleCenterIds("SataCoinTransaction", actor);
  const ruleWhere: Prisma.SataCoinRuleWhereInput =
    visibleCenters === "ALL" ? {} : { OR: [{ centerId: null }, { centerId: { in: visibleCenters } }] };
  const [hocVien, quyTac] = await Promise.all([
    sdb.student.findMany({
      where: { deletedAt: null },
      orderBy: { name: "asc" },
      take: 1000,
      select: { id: true, name: true, studentCode: true },
    }),
    sdb.sataCoinRule.findMany({
      where: { ...ruleWhere, isActive: true },
      orderBy: { createdAt: "asc" },
      select: { code: true, label: true, amount: true },
    }),
  ]);
  const soDuMap = new Map(soDu.map((r) => [r.studentId, r._sum.amount ?? 0]));
  return (
    <CapCoin
      hocVien={hocVien.map((h) => ({ ...h, soDu: soDuMap.get(h.id) ?? 0 }))}
      quyTac={quyTac}
      chonSan={hv && hocVien.some((h) => h.id === hv) ? hv : null}
    />
  );
}

async function TabQuyTac({ userId }: { userId: string }) {
  const actor = await resolveActor(userId);
  const visibleCenters = getModelVisibleCenterIds("SataCoinTransaction", actor);
  const ruleWhere: Prisma.SataCoinRuleWhereInput =
    visibleCenters === "ALL" ? {} : { OR: [{ centerId: null }, { centerId: { in: visibleCenters } }] };
  const quyTac = await scopedDb(actor).sataCoinRule.findMany({
    where: ruleWhere,
    orderBy: [{ isActive: "desc" }, { createdAt: "desc" }],
    select: { id: true, code: true, label: true, amount: true, isActive: true },
  });
  return <QuyTacThuong quyTac={quyTac} />;
}

async function TabSoCai({ userId, q, trang }: { userId: string; q: string | undefined; trang: number }) {
  const sdb = await sdbCua(userId);
  const where: Prisma.SataCoinTransactionWhereInput = q
    ? { student: { name: { contains: q, mode: "insensitive" } } }
    : {};
  const tong = await sdb.sataCoinTransaction.count({ where });
  const soTrang = Math.max(1, Math.ceil(tong / MOI_TRANG));
  const t = Math.min(trang, soTrang);
  const gd = await sdb.sataCoinTransaction.findMany({
    where,
    orderBy: { createdAt: "desc" },
    skip: (t - 1) * MOI_TRANG,
    take: MOI_TRANG,
    select: {
      id: true,
      amount: true,
      type: true,
      reason: true,
      note: true,
      reversedTxId: true,
      createdAt: true,
      studentId: true,
      student: { select: { name: true } },
    },
  });
  // Giao dịch nào đã bị đảo: tra theo reversedTxId trỏ về nó (có thể nằm ngoài trang này).
  const daBiDao = new Set(
    (
      await sdb.sataCoinTransaction.findMany({
        where: { reversedTxId: { in: gd.map((x) => x.id) } },
        select: { reversedTxId: true },
      })
    ).map((x) => x.reversedTxId as string),
  );
  const href = (n: number) => {
    const p = new URLSearchParams({ tab: "so-cai" });
    if (q) p.set("q", q);
    if (n > 1) p.set("page", String(n));
    return `/satacoin?${p.toString()}`;
  };

  return (
    <>
      <OTim tab="so-cai" q={q} goiY="Lọc theo tên học viên…" />
      {gd.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border px-6 py-12 text-center text-sm text-muted-foreground">
          {q ? `Không có giao dịch nào của “${q}”.` : "Chưa có giao dịch nào."}
        </p>
      ) : (
        <>
          <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[680px] text-sm">
                <thead className="bg-muted/40">
                  <tr>
                    <th className={adminTh}>Ngày</th>
                    <th className={adminTh}>Học viên</th>
                    <th className={adminTh}>Lý do</th>
                    <th className={cn(adminTh, "text-right")}>Coin</th>
                    <th className={cn(adminTh, "text-right")}>Thao tác</th>
                  </tr>
                </thead>
                <tbody>
                  {gd.map((x) => (
                    <tr key={x.id} className={adminTr}>
                      <td className={cn(adminTd, "tabular-nums text-muted-foreground")}>{formatDateVN(x.createdAt)}</td>
                      <td className={cn(adminTd, "font-medium")}>{x.student.name}</td>
                      <td className={cn(adminTd, "max-w-[280px]")}>
                        <p className="truncate">
                          <span className="text-muted-foreground">{LOAI[x.type] ?? x.type} · </span>
                          {LY_DO[x.reason] ?? x.reason}
                        </p>
                        {x.note && <p className="truncate text-xs text-muted-foreground">{x.note}</p>}
                      </td>
                      <td
                        className={cn(
                          adminTd,
                          "text-right font-semibold tabular-nums",
                          x.amount >= 0 ? "text-state-success-ink" : "text-state-danger-ink",
                        )}
                      >
                        {x.amount >= 0 ? "+" : ""}
                        {x.amount}
                      </td>
                      <td className={cn(adminTd, "text-right")}>
                        {x.type !== "REVERSAL" && !daBiDao.has(x.id) ? (
                          <NutDao txId={x.id} studentId={x.studentId} />
                        ) : (
                          <span className="text-xs text-muted-foreground">
                            {daBiDao.has(x.id) ? "Đã đảo" : "—"}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <DieuHuongTrangLink className="mt-4" trang={t} soTrang={soTrang} hrefCua={href} />
        </>
      )}
    </>
  );
}
