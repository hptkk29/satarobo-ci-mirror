import { Suspense } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ScrollText } from "lucide-react";
import { auth } from "@/lib/auth";
import { checkPermission } from "@/lib/auth/check-permission";
import { resolveActor } from "@/lib/auth/actor";
import { canReadLegacyAudit } from "@/lib/audit/legacy-log";
import { scopedDb } from "@/lib/db-scope";
import { AuditLogClient } from "./_components/audit-log-client";
import { PageHelp } from "@/components/admin/ui/page-help";
import { duocXuatCuaPhienHienTai } from "@/lib/export/quyen-xuat";

export const metadata = { title: "Audit Log | Admin" };
export const dynamic = "force-dynamic";

export default async function AuditLogPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  // Khớp với quyền hiển thị menu (audit-logs:view) — trước đây gate users:manage
  // khiến CENTER_MANAGER thấy menu nhưng bị redirect về dashboard.
  if (!(await checkPermission("audit-logs:view"))) {
    redirect("/dashboard?error=unauthorized");
  }

  // Break-glass (câu 13 BGĐ) + prune destructive gate riêng (SUPER_ADMIN).
  const [canViewPii, canCleanup] = await Promise.all([
    checkPermission("audit-logs:view-pii"),
    checkPermission("users:manage"),
  ]);

  // User SCOPE_EXEMPT (identity toàn cục) → sdb pass-through, hành vi y nguyên.
  const actor = await resolveActor(session.user.id);
  const canReadLegacy = canReadLegacyAudit(actor);
  const sdb = scopedDb(actor);
  const actors = await sdb.user.findMany({
    where: { deletedAt: null },
    select: { id: true, name: true, email: true },
    orderBy: [{ name: "asc" }, { email: "asc" }],
  });

  return (
    <div>
      <div className="mb-6 flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary-soft">
          <ScrollText className="h-5 w-5 text-primary" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-foreground">Audit Log</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Nhật ký thay đổi toàn hệ thống
          </p>
          {/* #05 freeze-legacy: 5 bảng cũ đóng băng 09/07, chỉ Quản trị/Hội sở đọc được
              (bản ghi cũ không mang orgUnitId nên không lọc theo cơ sở được). */}
          {canReadLegacy ? (
            <Link
              href="/audit-log/legacy"
              className="mt-2 inline-block text-sm font-medium text-primary hover:underline"
            >
              Xem lịch sử cũ (đọc-only) →
            </Link>
          ) : null}
        </div>
      </div>

      <PageHelp>
        <p>
          Nhật ký thay đổi hợp nhất toàn hệ thống. Quản lý cơ sở chỉ thấy log cơ
          sở mình; PII (SĐT/email) che mặc định, xem đầy đủ có kiểm soát.
        </p>
      </PageHelp>

      <Suspense
        fallback={<div className="h-40 animate-pulse rounded-xl bg-muted" />}
      >
        <AuditLogClient
          xuatDuoc={await duocXuatCuaPhienHienTai("audit-log")}
          actors={actors}
          canViewPii={canViewPii}
          canCleanup={canCleanup}
        />
      </Suspense>
    </div>
  );
}
