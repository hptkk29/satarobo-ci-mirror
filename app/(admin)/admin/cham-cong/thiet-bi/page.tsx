// app/(admin)/admin/cham-cong/thiet-bi/page.tsx — THIẾT BỊ CHẤM CÔNG theo khối (P2.3, 11/10/2026).
//
// Người có ca ở khối (60 ngày gần đây) × máy đã dùng để chấm công. Nút duyệt / thu hồi / báo mất / đặt lại
// chỉ hiện khi có `hr_attendance:device-reset` ở khối — cùng cổng action kiểm (luật 12).
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { resolveActor } from "@/lib/auth/actor";
import { scopedDb } from "@/lib/db-scope";
import { ASK_WHO, loadModuleScope, type ModuleAction } from "@/lib/cham-cong/module-scope";
import { danhSachThietBi, docCauHinhThietBi } from "@/lib/cham-cong/thiet-bi";
import { daDatLai } from "@/lib/cham-cong/thiet-bi-thuan";
import { vnAddDays, vnDateOnly } from "@/lib/time/vn";
import { PageHeader } from "@/components/admin/ui/page-header";
import { EmptyState, NoPermission } from "@/components/admin/ui/states";
import { ModuleNav } from "@/components/admin/cham-cong/module-nav";
import { ConfigTabs } from "@/components/admin/cham-cong/config-tabs";
import { ScopeBar } from "@/components/admin/cham-cong/scope-bar";
import { SectionCard } from "@/components/admin/cham-cong/section-card";
import { BangThietBi, type NguoiVaThietBi } from "./_components/bang-thiet-bi";

export const metadata = { title: "Thiết bị chấm công | Admin", robots: { index: false } };
export const dynamic = "force-dynamic";

const VIEW: ModuleAction = "hr_attendance:view";
const RESET: ModuleAction = "hr_attendance:device-reset";
const BASE = "/cham-cong/thiet-bi";

const NHAN_CHE_DO: Record<string, string> = {
  OFF: "TẮT — hệ thống chưa ghi nhận thiết bị nào khi chấm công.",
  OBSERVE: "CHỈ THEO DÕI — ghi nhận máy, gắn cờ lượt chấm từ máy lạ / máy thu hồi, không chặn ai.",
  ENFORCE: "SIẾT — chặn lượt chấm từ máy đã thu hồi / báo mất.",
};

export default async function ThietBiPage({ searchParams }: { searchParams: Promise<{ coSo?: string }> }) {
  const session = await auth();
  if (!session?.user) redirect("/login?callbackUrl=%2Fcham-cong%2Fthiet-bi");
  const sp = await searchParams;
  const scope = await loadModuleScope(session.user.id);
  const visible = scope.blocksWith(VIEW);
  if (visible.length === 0) {
    return (
      <div className="max-w-6xl">
        <PageHeader title="Thiết bị chấm công" />
        <ModuleNav active="cauhinh" scope={scope} ctx={{ coSo: sp.coSo ?? null }} />
        <NoPermission permission={VIEW} what="thiết bị chấm công" askWho={ASK_WHO[VIEW]} />
      </div>
    );
  }
  const block = scope.pick(sp.coSo, VIEW) ?? visible[0];
  const coSo = block.id;
  const quanLyDuoc = scope.has(RESET, coSo);
  const cauHinh = await docCauHinhThietBi();

  const sdb = scopedDb(await resolveActor(session.user.id));
  const ca = await sdb.shiftAssignment.findMany({
    where: { centerId: coSo, workDate: { gte: vnDateOnly(vnAddDays(new Date(), -60)) } },
    select: { userId: true },
    distinct: ["userId"],
  });
  const userIds = ca.map((c) => c.userId);
  const [users, may] = await Promise.all([
    userIds.length ? sdb.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true, email: true } }) : Promise.resolve([]),
    danhSachThietBi(userIds),
  ]);
  const ten = new Map(users.map((u) => [u.id, u.name ?? u.email ?? u.id]));
  const dong: NguoiVaThietBi[] = userIds
    .map((id) => ({
      userId: id,
      ten: ten.get(id) ?? id,
      // `keyHash` KHÔNG xuống client — chỉ cờ "đã tháo khoá" (đặt lại).
      may: may
        .filter((m) => m.userId === id)
        .map(({ keyHash, ...m }) => ({ ...m, status: m.status as NguoiVaThietBi["may"][number]["status"], daDatLai: daDatLai(keyHash) })),
    }))
    .sort((a, b) => b.may.length - a.may.length || a.ten.localeCompare(b.ten, "vi"));

  return (
    <div className="max-w-6xl">
      <PageHeader
        title="Thiết bị chấm công"
        subtitle="Máy mỗi người đã dùng để chấm công. Định danh bằng mã ngẫu nhiên hệ thống cấp cho trình duyệt — xoá dữ liệu trình duyệt thì máy hiện như máy mới."
      />
      <ModuleNav active="cauhinh" scope={scope} ctx={{ coSo }} />
      <ConfigTabs active="thiet-bi" scope={scope} ctx={{ coSo }} />
      <ScopeBar basePath={BASE} blocks={visible.map((b) => ({ id: b.id, label: b.label }))} coSo={coSo} />
      <p role="status" className="mb-3 rounded-md border border-border bg-muted/40 px-3 py-2 text-sm text-foreground">
        Chế độ hiện tại: <b>{NHAN_CHE_DO[cauHinh.cheDo] ?? cauHinh.cheDo}</b> Tối đa {cauHinh.toiDa} máy tin cậy mỗi người
        {cauHinh.tuTinCayDauTien ? " · máy đầu tiên tự được tin cậy" : ""}.
      </p>
      {dong.length === 0 ? (
        <EmptyState title="Chưa có ai" description="Khối này chưa có người được xếp ca trong 60 ngày gần đây." />
      ) : (
        <SectionCard title={`Thiết bị — ${block.label}`}>
          <BangThietBi coSo={coSo} dong={dong} quanLyDuoc={quanLyDuoc} />
        </SectionCard>
      )}
    </div>
  );
}
