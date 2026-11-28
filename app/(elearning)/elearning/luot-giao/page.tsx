import { auth } from "@/lib/auth";
import { resolveActor } from "@/lib/auth/actor";
import { can } from "@/lib/auth/can";
import { scopedDb } from "@/lib/db-scope";
import { TieuDeTrang as PageHeader } from "@/app/(elearning)/elearning/_components/ui/tieu-de-trang";
import { EmptyState, NoPermission } from "@/components/admin/ui/states";
import { Khoi, TrangQuanTri } from "../_components/ui/trang";
import { NUT_CHINH } from "../_components/ui/dieu-khien";
import { AssignmentList } from "../giao-bai/_components/assignment-list";
import {
  MA_TAB_LUOT_GIAO,
  TAB_LUOT_GIAO,
  TAB_LUOT_GIAO_MAC_DINH,
  cauLyDoDong,
  tongHopLuotGiao,
} from "@/lib/elearning/luot-giao-tab";
import { tabDangMo, type SearchParamsTho } from "@/lib/elearning/tab-url";
import { TabNav } from "../_components/ui/tab-nav";

/**
 * QtLuotGiao — LƯỢT GIAO ĐÃ TẠO (tách khỏi trang Giao khoá theo thiết kế `03-quan-tri/QtLuotGiao.html`).
 *
 * Ba việc vận hành trên một lượt (gia hạn · ghi nhận sự cố · thu hồi) vẫn là ba action cũ của EL-05 — trang này chỉ là chỗ ĐẶT chúng ở lối vào riêng.
 * Quyền: cùng `elearning:assignment:create` như trang Giao khoá (một quyền cho cả "giao" lẫn "vận hành lượt đã giao").
 */
export const dynamic = "force-dynamic";

export const metadata = {
  title: "Lượt giao | Sata Robo",
  robots: { index: false, follow: false },
};

export default async function Page({ searchParams }: { searchParams: Promise<SearchParamsTho> }) {
  const session = await auth();
  if (!session?.user?.id) {
    return (
      <TrangQuanTri rong="hep">
        <EmptyState title="Chưa đăng nhập" description="Đăng nhập rồi mở lại trang này." />
      </TrangQuanTri>
    );
  }
  const actor = await resolveActor(session.user.id);

  if (!can(actor, "elearning:assignment:create")) {
    return (
      <TrangQuanTri rong="hep">
        <PageHeader title="Lượt giao" />
        <NoPermission permission="elearning:assignment:create" what="danh sách lượt giao" askWho="phòng Đào tạo" />
      </TrangQuanTri>
    );
  }

  const db = scopedDb(actor);
  // `TrnAssignment` mang `title` của CHÍNH lượt giao và KHÔNG có quan hệ ngược tới `TrnEnrollment` — đếm người bằng `groupBy` riêng.
  const luotGiao = await db.trnAssignment.findMany({
    select: { id: true, title: true, dueAt: true, status: true },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  const ids = luotGiao.map((x: { id: string }) => x.id);
  // MỘT groupBy theo (lượt giao × trạng thái): từ đó suy tổng, quá hạn, đạt/trễ và "đã đóng" — số truy vấn không tăng theo số lượt giao.
  const theoTrangThai = ids.length
    ? await db.trnEnrollment.groupBy({
        by: ["assignmentId", "status"],
        where: { assignmentId: { in: ids } },
        _count: { _all: true },
      })
    : [];
  const demCua = new Map<string, Record<string, number>>();
  for (const g of theoTrangThai as { assignmentId: string | null; status: string; _count: { _all: number } }[]) {
    const k = g.assignmentId ?? "";
    demCua.set(k, { ...(demCua.get(k) ?? {}), [g.status]: g._count._all });
  }
  const tatCa = luotGiao.map((x: { id: string; title: string; dueAt: Date | null; status: string }) => {
    const th = tongHopLuotGiao(x.status, demCua.get(x.id) ?? {});
    return {
      assignmentId: x.id,
      tenKhoa: x.title,
      soNguoi: th.soNguoi,
      soQuaHan: th.soQuaHan,
      hanChung: x.dueAt,
      dong: th.daDong,
      lyDoDong: cauLyDoDong(th),
    };
  });
  const tab = tabDangMo(await searchParams, MA_TAB_LUOT_GIAO, TAB_LUOT_GIAO_MAC_DINH);
  const ds = tatCa.filter((x: { dong: boolean }) => x.dong === (tab === "da-dong"));
  const tabKhaiBao = TAB_LUOT_GIAO.map((t) => ({
    id: t.id,
    nhan: t.nhan,
    dem: tatCa.filter((x: { dong: boolean }) => x.dong === (t.id === "da-dong")).length,
  }));

  return (
    <TrangQuanTri rong="vua">
      <PageHeader
        title="Lượt giao"
        subtitle="Gia hạn, ghi nhận sự cố hoặc thu hồi. Mọi thao tác đều bắt buộc lý do và đi vào nhật ký kiểm toán."
        actions={
          <a href="/elearning/giao-bai" className={NUT_CHINH}>
            Giao khoá mới
          </a>
        }
      />
      <Khoi id="luot-giao" tieuDe="Lượt giao đã tạo" sat>
        <div className="px-4 pt-1">
          <TabNav duongDan="/elearning/luot-giao" tab={tabKhaiBao} dangMo={tab} nhanDanhSach="Lượt giao đã tạo" />
        </div>
        <AssignmentList ds={ds} />
      </Khoi>
    </TrangQuanTri>
  );
}
