import Link from "next/link";
import { redirect } from "next/navigation";
import { ChevronLeft, ClipboardCheck } from "lucide-react";
import { auth } from "@/lib/auth";
import { hasRole } from "@/lib/auth/permissions";
import { checkPermission } from "@/lib/auth/check-permission";
import { resolveActor } from "@/lib/auth/actor";
import { scopedDb } from "@/lib/db-scope";
import { OPEN_FIELDS, CLOSE_FIELDS, type ChecklistKey } from "@/lib/center-checklist";
import { PhanTrangBang } from "@/components/ui/phan-trang-bang";

export const metadata = { title: "Tổng quan checklist cơ sở | Admin" };
export const dynamic = "force-dynamic";

const DAYS = 14;

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// P2 — tổng quan hoàn thành checklist mở/đóng theo NGÀY × CƠ SỞ (14 ngày gần nhất).
export default async function ChecklistOverviewPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const isSuper = hasRole(session.user, "SUPER_ADMIN");
  const isCM = hasRole(session.user, "CENTER_MANAGER");
  const centerScope = isCM && !isSuper ? session.user.centerId : null;

  if (!(await checkPermission("hr_attendance:view", { centerId: centerScope ?? session.user.centerId ?? null }))) {
    redirect("/dashboard");
  }

  // Cách ly cơ sở (A0-04): CenterDayChecklist ∈ SCOPED_MODELS → đọc qua scopedDb.
  const actor = await resolveActor(session.user.id);
  const sdb = scopedDb(actor);

  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (DAYS - 1));

  const [centers, rows] = await Promise.all([
    sdb.center.findMany({
      where: { isActive: true, ...(centerScope ? { id: centerScope } : {}) },
      orderBy: { displayOrder: "asc" },
      select: { id: true, name: true },
    }),
    sdb.centerDayChecklist.findMany({
      where: { date: { gte: start }, ...(centerScope ? { centerId: centerScope } : {}) },
      select: {
        centerId: true,
        date: true,
        openPower: true, openDevices: true, openRoomsReady: true, openCleanCommon: true, openSecurity: true,
        closePower: true, closeDevices: true, closeLock: true, closeKpiBoard: true, closeSafety: true, closeHandover: true,
      },
    }),
  ]);

  const byKey = new Map<string, (typeof rows)[number]>();
  for (const r of rows) byKey.set(`${r.centerId}|${ymd(r.date)}`, r);

  const dates: Date[] = [];
  for (let i = 0; i < DAYS; i++) dates.push(new Date(start.getFullYear(), start.getMonth(), start.getDate() + i));

  function status(rec: (typeof rows)[number] | undefined): { open: boolean; close: boolean } {
    if (!rec) return { open: false, close: false };
    const r = rec as unknown as Record<ChecklistKey, boolean>;
    return {
      open: OPEN_FIELDS.every((f) => r[f.key]),
      close: CLOSE_FIELDS.every((f) => r[f.key]),
    };
  }

  // Tỷ lệ ngày-cơ sở hoàn tất CẢ mở+đóng.
  let totalCells = 0;
  let fullCells = 0;
  for (const c of centers) {
    for (const d of dates) {
      totalCells++;
      const st = status(byKey.get(`${c.id}|${ymd(d)}`));
      if (st.open && st.close) fullCells++;
    }
  }
  const pct = totalCells > 0 ? Math.round((fullCells / totalCells) * 100) : 0;

  return (
    <div className="p-6">
      <Link href="/cham-cong/checklist-co-so" className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ChevronLeft className="h-4 w-4" /> Nhập checklist
      </Link>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-2">
        <h1 className="flex items-center gap-2 text-2xl font-bold text-foreground">
          <ClipboardCheck className="h-6 w-6 text-primary" /> Tổng quan checklist cơ sở
        </h1>
        <div className="rounded-xl border border-border bg-card px-4 py-2 text-center">
          <p className="text-2xl font-bold text-primary">{pct}%</p>
          <p className="text-xs text-muted-foreground">{fullCells}/{totalCells} ngày-cơ sở đủ mở+đóng · {DAYS} ngày</p>
        </div>
      </div>

      <p className="mb-3 text-xs text-muted-foreground">
        Ô: <span className="font-semibold text-state-success-ink">●</span> đủ mở+đóng ·
        <span className="font-semibold text-state-warning-ink"> ◐</span> thiếu 1 trong 2 ·
        <span className="font-semibold text-state-danger-ink"> ○</span> chưa làm. Di chuột để xem ngày.
      </p>

      {/* `overflow-hidden` chứ KHÔNG `overflow-x-auto`: để vùng cuộn trùng với thẻ bo góc là
          viền vẽ theo border-box và không cuộn, còn nội dung cuộn bên dưới bị cắt theo
          padding-box đã bo ⇒ kéo sang phải thì dải nền header bị vạt chéo ở góc. Đẩy việc
          cuộn xuống div con bằng `cuonNgang`, giống 10 bảng còn lại của module — và nhờ vậy
          thanh phân trang cũng thôi trôi khỏi màn khi kéo ngang. */}
      <div className="overflow-hidden rounded-xl border border-border bg-card">
        <PhanTrangBang cuonNgang tenDonVi="cơ sở" khoaGhiNho="checklist-tong-quan">
          <table className="w-full min-w-[900px] text-sm">
            <thead className="bg-muted text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2">Cơ sở</th>
                {dates.map((d) => (
                  <th key={ymd(d)} className="px-2 py-2 text-center">
                    {String(d.getDate()).padStart(2, "0")}/{String(d.getMonth() + 1).padStart(2, "0")}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {centers.map((c) => (
                <tr key={c.id} className="border-t">
                  <td className="px-3 py-2 font-medium text-foreground">{c.name}</td>
                  {dates.map((d) => {
                    const st = status(byKey.get(`${c.id}|${ymd(d)}`));
                    const full = st.open && st.close;
                    const partial = st.open || st.close;
                    const sym = full ? "●" : partial ? "◐" : "○";
                    const cls = full ? "text-state-success-ink" : partial ? "text-state-warning-ink" : "text-state-danger-ink";
                    const title = `${c.name} ${ymd(d)} — mở: ${st.open ? "đủ" : "thiếu"}, đóng: ${st.close ? "đủ" : "thiếu"}`;
                    return (
                      <td key={ymd(d)} className={`px-2 py-2 text-center text-lg ${cls}`} title={title}>
                        {sym}
                      </td>
                    );
                  })}
                </tr>
              ))}
              {centers.length === 0 && (
                <tr>
                  <td colSpan={DAYS + 1} className="px-3 py-8 text-center text-muted-foreground">Không có cơ sở.</td>
                </tr>
              )}
            </tbody>
          </table>
        </PhanTrangBang>
      </div>
    </div>
  );
}
