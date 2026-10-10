// app/(admin)/admin/cham-cong/danh-muc-ca/page.tsx — MÃ CA: bảng chữ cái của cả module chấm công.
//
// Vì sao màn này tồn tại: giờ ca, số công, nơi làm, chế độ chấm là DỮ LIỆU người vận hành sửa
// được — không phải hằng số trong mã. Mọi ô trên lưới phân ca, mọi dòng import từ Sheet đều tra
// về đây; mã lạ ở import bị chặn cũng chỉ vì chưa khai ở màn này.
//
// Điều dễ vỡ:
//  · Quyền có HAI tầng: mã "Dùng chung" (centerId = null) chỉ người có config tại HỘI SỞ mới sửa
//    được, mã riêng cơ sở thì cần config tại chính cơ sở đó. Bảng vẫn HIỆN mã dùng chung cho mọi
//    người (ShiftTemplate ∈ NULL_IS_GLOBAL_MODELS) nên phải tự ẩn nút sửa, đừng để bấm rồi mới báo.
//  · Sửa mã ca KHÔNG hồi tố: ô lịch đã xếp giữ segments cũ (snapshot).
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { resolveActor } from "@/lib/auth/actor";
import { scopedDb } from "@/lib/db-scope";
import { HO_CENTER_ID, loadCenterMap } from "@/lib/cham-cong/home-center";
import { ASK_WHO, loadModuleScope } from "@/lib/cham-cong/module-scope";
import type { ShiftSegment } from "@/lib/cham-cong/catalog";
import { PageHeader } from "@/components/admin/ui/page-header";
import { PageHelp } from "@/components/admin/ui/page-help";
import { NoPermission } from "@/components/admin/ui/states";
import { ModuleNav } from "@/components/admin/cham-cong/module-nav";
import { ConfigTabs } from "@/components/admin/cham-cong/config-tabs";
import { TemplateTable, type TemplateRow } from "./_components/template-table";

export const metadata = { title: "Danh mục mã ca | Admin", robots: { index: false } };
export const dynamic = "force-dynamic";

export default async function DanhMucCaPage({
  searchParams,
}: {
  searchParams: Promise<{ ky?: string; coSo?: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login?callbackUrl=%2Fcham-cong%2Fdanh-muc-ca");
  const sp = await searchParams;
  // Màn này KHÔNG lọc theo khối — `ky`/`coSo` chỉ đi ngang qua để tab giữ ngữ cảnh người dùng.
  const ctx = { ky: sp.ky ?? null, coSo: sp.coSo ?? null };
  const scope = await loadModuleScope(session.user.id);
  const canGlobal = scope.has("hr_attendance:config", HO_CENTER_ID);

  const head = (
    <>
      <PageHeader
        title="Mã ca"
        subtitle="Mỗi mã là một kiểu ngày làm: giờ, số công, nơi làm, có phải quét QR không."
      />
      <ModuleNav active="cauhinh" scope={scope} ctx={ctx} />
    </>
  );

  // Vào được nếu có config ở Hội sở HOẶC ở ít nhất một cơ sở. Không quyền thì nói thiếu quyền gì
  // và hỏi ai — không đá về màn khác (người dùng không hiểu vì sao mình bị đẩy đi).
  if (!scope.any("hr_attendance:config")) {
    return (
      <div className="max-w-6xl">
        {head}
        <NoPermission
          permission="hr_attendance:config"
          what="danh mục mã ca"
          askWho={ASK_WHO["hr_attendance:config"]}
        />
      </div>
    );
  }

  const map = await loadCenterMap();
  const sdb = scopedDb(await resolveActor(session.user.id));
  const [templates, centers] = await Promise.all([
    sdb.shiftTemplate.findMany({ orderBy: [{ displayOrder: "asc" }, { code: "asc" }] }),
    sdb.center.findMany({
      where: { isActive: true, code: { in: Object.keys(map.byCode) } },
      select: { id: true, code: true, name: true },
      orderBy: { displayOrder: "asc" },
    }),
  ]);
  const centerName = new Map(centers.map((c) => [c.id, c.name]));
  const rows: TemplateRow[] = templates.map((t) => ({
    id: t.id,
    code: t.code,
    name: t.name,
    kind: t.kind,
    segments: ((t.segments as ShiftSegment[] | null) ?? []).map((s) => ({
      start: s.start,
      end: s.end,
      kind: s.kind,
      place: s.place,
    })),
    defaultPlace: t.defaultPlace,
    attendanceMode: t.attendanceMode,
    dayCredit: t.dayCredit,
    isLeave: t.isLeave,
    nominalMinutes: t.nominalMinutes,
    payMode: t.payMode,
    // Cột DB là Int (`@default(1)`); form chỉ nhận 0/1/2. Giá trị lạ (ai sửa tay DB) rơi về 1
    // — cùng chiều FAIL-CLOSED với schema, chứ không im lặng thành 0 = thôi kiểm quét.
    soCapQuetKyVong: ([0, 1, 2] as const).includes(t.soCapQuetKyVong as 0 | 1 | 2)
      ? (t.soCapQuetKyVong as 0 | 1 | 2)
      : 1,
    note: t.note,
    isActive: t.isActive,
    centerId: t.centerId,
    centerName: t.centerId ? (centerName.get(t.centerId) ?? t.centerId) : null,
  }));

  return (
    <div className="max-w-6xl">
      {head}
      <ConfigTabs active="danh-muc-ca" scope={scope} ctx={ctx} />
      <PageHelp guideSlug="nhan-su-giao-vien">
        <p>
          Mỗi mã làm việc = 1 công/ngày, đúng như cách đếm trên Sheet; mã nghỉ (X, P) = 0 công. Ca gãy khai
          nhiều đoạn; nghỉ giữa giờ có tính công thì kẹp một đoạn &ldquo;nghỉ giữa giờ&rdquo; giữa
          hai đoạn làm việc.
        </p>
        <p className="mt-2">
          Sửa một mã KHÔNG làm đổi lịch đã xếp: ô cũ giữ giờ cũ, chỉ ô xếp sau khi sửa mới dùng giờ
          mới. Muốn đổi giờ cho cả tháng đang chạy thì tạo mã mới rồi xếp lại, đừng sửa mã cũ.
        </p>
        <p className="mt-2">
          Mã &ldquo;Dùng chung&rdquo; áp cho mọi cơ sở nên chỉ Hội sở sửa được. Mã riêng cơ sở chỉ
          hiện với người của cơ sở đó.
        </p>
      </PageHelp>
      <TemplateTable
        rows={rows}
        centers={centers.map((c) => ({ id: c.id, code: c.code ?? "", name: c.name }))}
        canGlobal={canGlobal}
      />
    </div>
  );
}
