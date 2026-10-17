// Quản lý chia lead (29/08/2026) — Tab 1 cấu hình pool · Tab 2 sổ chia lead.
//
// Gộp hai việc vốn nằm hai chỗ: "ai đang nhận lead" (trước đây là điều kiện NGẦM,
// không màn nào sửa được) và "vòng chia đã chia cho ai" (màn `/leads/so-luot` cũ,
// chỉ đọc). Sổ lượt cũ nay là cột "Lượt đã nhận" của Tab 1.
//
// QUYỀN: `lead_pool:manage` — Quản trị + Quản lý cơ sở. QLCS KHÔNG thấy ô chọn cơ
// sở: họ chỉ có một cơ sở, bày ra là mời bấm nhầm. Quyền THẬT gác ở Server Action.
import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { checkPermission, checkAnyPermission } from "@/lib/auth/check-permission";
import { PAGE_GATES } from "@/lib/auth/page-gates";
import { resolveActor } from "@/lib/auth/actor";
import { scopedDb } from "@/lib/db-scope";
import { PageHelp } from "@/components/admin/ui/page-help";
import { layBangPool, layCoSoTheoKhuVuc } from "@/lib/lead/pool-board";
import { orgUnitIdCuaCoSo } from "@/lib/lead/pool";
import { getCenterMode } from "@/lib/lead/auto-assign";
import { CenterPicker } from "./_components/center-picker";
import { ModePicker } from "./_components/mode-picker";
import { PoolTable } from "./_components/pool-table";
import { SoChiaLead } from "./_components/so-chia";

export const metadata = { title: "Quản lý chia lead | Admin" };
export const dynamic = "force-dynamic";

type SP = Promise<{
  co_so?: string;
  tab?: string;
  tu?: string;
  den?: string;
  sale?: string;
  nguon?: string;
  tieu_luot?: string;
  trang?: string;
}>;

export default async function QuanLyChiaLeadPage({ searchParams }: { searchParams: SP }) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!(await checkAnyPermission(PAGE_GATES["/quan-ly-chia-lead"]))) redirect("/dashboard");

  const sp = await searchParams;
  const actor = await resolveActor(session.user.id);
  const sdb = scopedDb(actor);
  const nhieuCoSo = actor.isSuperAdmin || actor.isHoLevel;

  // Center là SCOPE_EXEMPT (hạ tầng) ⇒ `sdb` pass-through, phải lọc TAY theo tầm nhìn.
  const centers = await sdb.center.findMany({
    where: {
      isActive: true,
      ...(nhieuCoSo ? {} : { id: { in: actor.visibleCenterIds } }),
    },
    select: { id: true, name: true },
    orderBy: { displayOrder: "asc" },
  });

  if (centers.length === 0) {
    return (
      <div className="max-w-6xl p-6">
        <h1 className="mb-1 text-2xl font-bold text-foreground">Quản lý chia lead</h1>
        <p className="text-sm text-muted-foreground">
          Tài khoản của bạn chưa gắn cơ sở nào — chưa có vòng chia để quản lý.
        </p>
      </div>
    );
  }

  const centerId = centers.find((c) => c.id === sp.co_so)?.id ?? centers[0].id;
  const tab = sp.tab === "so-chia" ? "so-chia" : "pool";
  const laQuanTri = await checkPermission("leads:assign-config");
  // 30/08 — ô chọn chế độ dời từ màn `/leads/cau-hinh-chia` (đã xoá) về đây.
  const cheDo = await getCenterMode(centerId);
  const coSoKhuVuc = await layCoSoTheoKhuVuc(centers.map((c) => c.id));

  const rows = await layBangPool(centerId);
  const trongBang = new Set(rows.map((r) => r.userId));
  const chuaCoTrongPool = (
    // User ∈ SCOPE_EXEMPT ⇒ `sdb` pass-through, hành vi y nguyên; đi qua nó để không
    // mở đường `@/lib/db` trần trong admin (ESLint chặn — luật cứng #4 CLAUDE.md).
    await sdb.user.findMany({
      where: { centerId, isActive: true, deletedAt: null, roles: { has: "SALES_CSM" } },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    })
  ).filter((u) => !trongBang.has(u.id));

  // 03/09 — SỔ CHIA LỌC THEO ĐÚNG CƠ SỞ ĐANG CHỌN (chủ dự án chốt).
  //
  // Bản cũ map qua `centers` — tức MỌI cơ sở người dùng thấy — nên `?co_so=` chỉ
  // đổi được tab "Pool" (dùng `layBangPool(centerId)`), còn tab "Sổ chia" vẫn liệt
  // kê lượt chia của tất cả cơ sở. Hai tab cùng một ô lọc mà nghe theo hai thứ
  // khác nhau là chỗ dễ đọc nhầm nhất: người dùng tưởng cơ sở mình đang xem có
  // ngần ấy lượt chia.
  const orgUnitIdChon = await orgUnitIdCuaCoSo(centerId);
  const orgUnitIds = orgUnitIdChon ? [orgUnitIdChon] : [];

  const qs = (p: Record<string, string>) => {
    const u = new URLSearchParams({ co_so: centerId, ...p });
    return `/quan-ly-chia-lead?${u.toString()}`;
  };

  return (
    <div className="max-w-6xl space-y-4 p-6">
      <div>
        <h1 className="mb-1 text-2xl font-bold text-foreground">Quản lý chia lead</h1>
        <p className="text-sm text-muted-foreground">
          Ai đang nhận lead tự động, và vòng chia đã chia cho ai.
        </p>
      </div>

      <PageHelp>
        <p>
          Tắt một người là họ <strong>thôi nhận lead mới</strong> — lead đang giữ vẫn
          nguyên. Bộ đếm lượt của họ đóng băng, không bị xoá.
        </p>
        <p className="mt-2">
          Bật lại thì lượt được <strong>đặt về mức thấp nhất</strong> của những người
          đang nhận, để họ không bị dồn lead bù cho những ngày nghỉ.
        </p>
      </PageHelp>

      {/* 30/08 — ô chọn HAI TẦNG (khu vực → cơ sở) thay dãy nút phẳng: dãy nút đẹp với
          hai cơ sở, nhưng mười lăm cơ sở thì nó tràn hai dòng và phải đọc hết mới tìm
          ra chỗ mình. QLCS chỉ có một cơ sở nên không hiện gì. */}
      {centers.length > 1 && (
        <CenterPicker centers={coSoKhuVuc} centerId={centerId} tab={tab} />
      )}

      <div className="flex gap-2 border-b border-border">
        {[
          { key: "pool", label: "Cấu hình pool" },
          { key: "so-chia", label: "Sổ chia lead" },
        ].map((t) => (
          <Link
            key={t.key}
            href={qs({ tab: t.key })}
            // Đổi tab = đổi `?tab=` của CHÍNH trang này. Không có `scroll={false}`
            // thì App Router cuốn về đầu trang sau mỗi lần bấm.
            scroll={false}
            className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium ${
              tab === t.key
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {t.label}
          </Link>
        ))}
      </div>

      {tab === "pool" ? (
        <div className="space-y-4">
          <ModePicker centerId={centerId} mode={cheDo} canEdit={laQuanTri} />
            <PoolTable
            centerId={centerId}
            rows={rows}
            chuaCoTrongPool={chuaCoTrongPool}
            laQuanTri={laQuanTri}
          />
        </div>
      ) : (
        <SoChiaLead
          orgUnitIds={orgUnitIds}
          nguoiTrongPool={rows.map((r) => ({ id: r.userId, name: r.name }))}
          sp={sp}
          centerId={centerId}
        />
      )}
    </div>
  );
}
