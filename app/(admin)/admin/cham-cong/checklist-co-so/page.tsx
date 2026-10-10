import Link from "next/link";
import { redirect } from "next/navigation";
import { ClipboardCheck } from "lucide-react";
import { auth } from "@/lib/auth";
import { hasRole } from "@/lib/auth/permissions";
import { checkPermission } from "@/lib/auth/check-permission";
import { resolveActor } from "@/lib/auth/actor";
import { scopedDb } from "@/lib/db-scope";
import { ALL_CHECKLIST_KEYS } from "@/lib/center-checklist";
import { CenterChecklistForm } from "./_components/checklist-form";

export const metadata = { title: "Checklist mở/đóng cơ sở | Admin" };
export const dynamic = "force-dynamic";

interface Props {
  searchParams: Promise<{ date?: string; centerId?: string }>;
}

export default async function CenterChecklistPage({ searchParams }: Props) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const sp = await searchParams;
  const isSuper = hasRole(session.user, "SUPER_ADMIN");
  const isCM = hasRole(session.user, "CENTER_MANAGER");
  // Target gate: cơ sở CM cố định, hoặc cơ sở đang lọc, hoặc cơ sở của actor (fallback
  // cho CENTER_HR — tránh v2 luôn false vì thiếu target khi action có cả tầng CENTER).
  const gateCenterId = (isCM && session.user.centerId) || sp.centerId || session.user.centerId || null;
  if (!(await checkPermission("hr_attendance:view", { centerId: gateCenterId }))) redirect("/dashboard");

  // Cách ly cơ sở (A0-04): CenterDayChecklist ∈ SCOPED_MODELS → đọc qua scopedDb.
  const actor = await resolveActor(session.user.id);
  const sdb = scopedDb(actor);

  const now = new Date();
  const dateStr =
    sp.date && /^\d{4}-\d{2}-\d{2}$/.test(sp.date)
      ? sp.date
      : `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

  const centers = isSuper
    ? await sdb.center.findMany({ where: { isActive: true }, orderBy: { displayOrder: "asc" }, select: { id: true, name: true } })
    : isCM && session.user.centerId
      ? await sdb.center.findMany({ where: { id: session.user.centerId }, select: { id: true, name: true } })
      : await sdb.center.findMany({ where: { isActive: true }, orderBy: { displayOrder: "asc" }, select: { id: true, name: true } });

  // CM cố định cơ sở mình; còn lại chọn (mặc định cơ sở đầu).
  const centerId = isCM && session.user.centerId ? session.user.centerId : (sp.centerId || centers[0]?.id || "");
  const canEdit =
    isSuper ||
    (isCM && centerId === session.user.centerId) ||
    (await checkPermission("hr_attendance:view", { centerId: centerId || null }));

  const date = new Date(`${dateStr}T00:00:00`);
  const existing = centerId
    ? await sdb.centerDayChecklist.findUnique({ where: { centerId_date: { centerId, date } } })
    : null;

  const existingRec = existing as unknown as Record<string, unknown> | null;
  const initial: Record<string, boolean> = {};
  for (const k of ALL_CHECKLIST_KEYS) initial[k] = existingRec ? existingRec[k] === true : false;

  return (
    <div className="max-w-3xl p-6">
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <h1 className="flex items-center gap-2 text-2xl font-bold text-foreground">
          <ClipboardCheck className="h-6 w-6 text-primary" /> Checklist mở/đóng cơ sở
        </h1>
        <Link href="/cham-cong/checklist-co-so/tong-quan" className="rounded-lg border border-border px-3 py-1.5 text-sm font-semibold text-foreground hover:bg-muted">
          Tổng quan →
        </Link>
      </div>
      <p className="mb-4 text-sm text-muted-foreground">Tick đầu ngày khi mở cơ sở và cuối ngày khi đóng.</p>

      <form method="GET" className="mb-4 flex flex-wrap items-end gap-2">
        <label className="block">
          <span className="mb-1 block text-xs text-muted-foreground">Ngày</span>
          <input type="date" name="date" defaultValue={dateStr} className="rounded-lg border border-border px-3 py-1.5 text-sm" />
        </label>
        {!isCM && centers.length > 1 && (
          <label className="block">
            <span className="mb-1 block text-xs text-muted-foreground">Cơ sở</span>
            <select name="centerId" defaultValue={centerId} className="rounded-lg border border-border px-3 py-1.5 text-sm">
              {centers.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </label>
        )}
        <button type="submit" className="rounded-lg bg-gray-800 px-3 py-1.5 text-sm font-medium text-white">Xem</button>
        <span className="ml-auto text-sm text-muted-foreground">
          {centers.find((c) => c.id === centerId)?.name ?? "—"}
        </span>
      </form>

      {centerId ? (
        <CenterChecklistForm
          centerId={centerId}
          date={dateStr}
          initial={initial}
          initialNote={existing?.note ?? ""}
          canEdit={canEdit}
        />
      ) : (
        <p className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">Chưa có cơ sở.</p>
      )}
    </div>
  );
}
