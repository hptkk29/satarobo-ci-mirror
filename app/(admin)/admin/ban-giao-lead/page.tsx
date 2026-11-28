import Link from "next/link";
import { redirect } from "next/navigation";
import { History } from "lucide-react";
import { auth } from "@/lib/auth";
import { hasRole } from "@/lib/auth/permissions";
import { canViewLeadPii, checkPermission } from "@/lib/auth/check-permission";
import { scopedDb } from "@/lib/db-scope";
import { resolveActor } from "@/lib/auth/actor";
import { HandoverForm } from "./_components/handover-form";
import { ChuyenLeadForm, type LeadChuyen } from "./_components/chuyen-lead-form";
import { PageHeader } from "@/components/admin/ui/page-header";
import { PageHelp } from "@/components/admin/ui/page-help";
import type { LeadStatus } from "@prisma/client";
import { ALL_LEAD_STATUSES, LEAD_CLOSED_STATUSES, leadStatusLabel } from "@/lib/leads/status";
import { formatPhoneVN } from "@/lib/phone";
import { maskPhone } from "@/lib/utils";
import { cn } from "@/lib/utils";

export const metadata = { title: "Bàn giao lead | Admin" };
export const dynamic = "force-dynamic";

// Trạng thái được phép lọc khi bàn giao HÀNG LOẠT. Khai kiểu LeadStatus[] có chủ ý: prop nhận
// string[] nên trước đây mảng này KHÔNG được kiểm kiểu — đổi tên enum ở GĐ5 không làm tsc đỏ.
// Suy từ ALL_LEAD_STATUSES trừ DA_MAT (xem LEAD_CLOSED_STATUSES) thay vì gõ tay.
const LEAD_STATUSES: LeadStatus[] = ALL_LEAD_STATUSES.filter((s) => !LEAD_CLOSED_STATUSES.includes(s));

type Tab = "chuyen" | "hang-loat";

// 01/10/2026 — chủ dự án thiết kế lại: màn này nay có HAI việc.
//   · "Chuyển lead" — SALE chuyển những lead phụ huynh đổi nhu cầu sang cơ sở/sale khác
//     (quyền `leads:edit`, như nút Chuyển lead ở chi tiết lead; Sale chỉ thấy lead của mình).
//   · "Bàn giao hàng loạt" — QUẢN LÝ chuyển toàn bộ lead của một sale (vd nghỉ việc), giữ
//     nguyên cổng `leads:assign` cũ.
export default async function HandoverPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const [coTheChuyen, coTheHangLoat, xemTatCa, xemPii, sp] = await Promise.all([
    checkPermission("leads:edit"),
    checkPermission("leads:assign"),
    checkPermission("leads:view-all"),
    canViewLeadPii(),
    searchParams,
  ]);
  if (!coTheChuyen && !coTheHangLoat) redirect("/dashboard");
  const tab: Tab =
    sp.tab === "hang-loat" && coTheHangLoat ? "hang-loat" : coTheChuyen ? "chuyen" : "hang-loat";

  // Quản lý cơ sở (không kèm Quản trị) chỉ bàn giao hàng loạt trong cơ sở mình — giữ nguyên
  // luật của màn cũ.
  const centerScope =
    hasRole(session.user, "CENTER_MANAGER") && !hasRole(session.user, "SUPER_ADMIN")
      ? (session.user.centerId ?? null)
      : null;

  const tabs: [Tab, string][] = [
    ...(coTheChuyen ? ([["chuyen", "Chuyển lead"]] as [Tab, string][]) : []),
    ...(coTheHangLoat ? ([["hang-loat", "Bàn giao hàng loạt"]] as [Tab, string][]) : []),
  ];

  return (
    <div>
      <PageHeader
        title="Bàn giao lead"
        subtitle={
          tab === "chuyen"
            ? "Chuyển lead sang cơ sở hoặc sale khác khi phụ huynh đổi nhu cầu"
            : "Chuyển toàn bộ lead của một sale sang sale khác"
        }
        actions={
          <Link
            href="/leads/bao-cao-chuyen"
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border bg-card px-3 text-sm font-medium text-foreground hover:bg-muted"
          >
            <History className="size-4" aria-hidden />
            Lịch sử chuyển
          </Link>
        }
      />

      {tabs.length > 1 && (
        <nav className="mb-4 flex gap-1 overflow-x-auto border-b border-border" aria-label="Bàn giao lead">
          {tabs.map(([k, nhan]) => (
            <Link
              key={k}
              href={k === "chuyen" ? "/ban-giao-lead" : "/ban-giao-lead?tab=hang-loat"}
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
      )}

      {tab === "chuyen" ? (
        <TabChuyen userId={session.user.id} xemTatCa={xemTatCa} xemPii={xemPii} />
      ) : (
        <TabHangLoat userId={session.user.id} centerScope={centerScope} />
      )}
    </div>
  );
}

// ⚠️ Tab nhận `userId`, KHÔNG nhận `sdb`: prop của server component được React bản dev chép
// vào debug info, và chép proxy Prisma làm `_debugInfo` nở tới sập ("Invalid array length",
// đo 30/09 ở màn Học bù). `resolveActor` có `cache()` nên không tra lại.
async function TabChuyen({
  userId,
  xemTatCa,
  xemPii,
}: {
  userId: string;
  xemTatCa: boolean;
  xemPii: boolean;
}) {
  const sdb = scopedDb(await resolveActor(userId));
  const [leads, coSo, sales] = await Promise.all([
    // Lead đang mở trong tầm nhìn (scopedDb cắt theo cơ sở). Sale thiếu `leads:view-all` chỉ
    // thấy lead mình chăm — đúng luật `transferLead` ("Chỉ chuyển được lead của bạn").
    sdb.lead.findMany({
      where: {
        deletedAt: null,
        convertedAt: null,
        status: { notIn: LEAD_CLOSED_STATUSES },
        ...(xemTatCa ? {} : { assignedToId: userId }),
      },
      orderBy: { updatedAt: "desc" },
      take: 300,
      select: {
        id: true,
        parentName: true,
        childName: true,
        phone: true,
        status: true,
        centerId: true,
        center: { select: { name: true } },
        course: { select: { name: true } },
        assignedTo: { select: { name: true } },
      },
    }),
    // Cơ sở nhận: MỌI cơ sở đang hoạt động (chuyển liên cơ sở là cả mục đích của màn), trùng
    // nguồn với hộp thoại chuyển ở chi tiết lead. Hội sở bị `transferLead` chặn ở server.
    sdb.center.findMany({
      where: { isActive: true },
      orderBy: { displayOrder: "asc" },
      select: { id: true, name: true },
    }),
    sdb.user.findMany({
      where: { roles: { has: "SALES_CSM" }, isActive: true, deletedAt: null },
      orderBy: { name: "asc" },
      select: { id: true, name: true, centerId: true },
    }),
  ]);

  const rows: LeadChuyen[] = leads.map((l) => ({
    id: l.id,
    phuHuynh: l.parentName,
    con: l.childName,
    sdt: l.phone ? (xemPii ? formatPhoneVN(l.phone) : maskPhone(l.phone)) : null,
    trangThai: leadStatusLabel(l.status),
    coSoId: l.centerId,
    coSo: l.center?.name ?? null,
    khoa: l.course?.name ?? null,
    sale: l.assignedTo?.name ?? null,
  }));

  return (
    <>
      <PageHelp>
        <p>
          Tick các lead phụ huynh muốn đổi nhu cầu → chọn <strong>cơ sở nhận</strong> (và sale nhận, hoặc để
          hệ thống tự chia theo cơ sở đó) → ghi lại phụ huynh cần gì. Người nhận được báo ngay; lịch sử chuyển
          lưu ở “Lịch sử chuyển”.
        </p>
      </PageHelp>
      <ChuyenLeadForm leads={rows} coSo={coSo} sales={sales} xemTatCa={xemTatCa} />
    </>
  );
}

async function TabHangLoat({ userId, centerScope }: { userId: string; centerScope: string | null }) {
  const sdb = scopedDb(await resolveActor(userId));
  const [sales, campaigns] = await Promise.all([
    sdb.user.findMany({
      where: {
        roles: { has: "SALES_CSM" },
        deletedAt: null,
        ...(centerScope ? { centerId: centerScope } : {}),
      },
      orderBy: { name: "asc" },
      select: { id: true, name: true, email: true, isActive: true },
    }),
    sdb.lead.findMany({
      where: { utmCampaign: { not: null }, deletedAt: null },
      distinct: ["utmCampaign"],
      select: { utmCampaign: true },
      take: 100,
    }),
  ]);

  return (
    <div className="max-w-3xl space-y-5">
      <PageHelp>
        <p>
          Chuyển hàng loạt lead của một sale (vd khi nghỉ việc) sang sale khác. Có thể lọc theo trạng thái,
          chiến dịch, chỉ lead chưa đóng. Task đang mở cũng được chuyển. Ghi lịch sử + nhật ký kiểm toán; KHÔNG
          sửa tài khoản sale cũ.
        </p>
      </PageHelp>
      <HandoverForm
        sales={sales.map((s) => ({
          id: s.id,
          label: (s.name ?? s.email ?? s.id) + (s.isActive ? "" : " (đã nghỉ)"),
        }))}
        statuses={LEAD_STATUSES}
        campaigns={campaigns.map((c) => c.utmCampaign).filter((x): x is string => !!x)}
      />
    </div>
  );
}
