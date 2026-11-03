import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { checkPermission } from "@/lib/auth/check-permission";
import { resolveActor } from "@/lib/auth/actor";
import { getModelVisibleCenterIds, scopedDb } from "@/lib/db-scope";
import { docSoDong } from "@/lib/ui/phan-trang";
import { chuanNguong } from "@/lib/lead/lead-nguoi";
import { timLeadNguoi } from "@/lib/lead/nguoi-service";
import { BangLeadNguoi } from "./_components/bang-lead-nguoi";

export const dynamic = "force-dynamic";

/**
 * LEAD NGUỘI — khách chưa chốt mà lâu rồi không ai chăm.
 *
 * Yêu cầu 15/09/2026 của chủ dự án. Khác màn Bàn giao lead ở chỗ nó quét TOÀN BỘ tư vấn viên
 * cùng lúc, nên quản lý nhìn ra bức tranh "ai đang ôm lead mà không chăm" thay vì phải mở
 * từng người một.
 *
 * ── PHÂN TRANG ĐI QUA URL, GIỐNG `/leads` (chốt 16/09/2026) ──────────────────────────────
 * Bản đầu giữ trang trong state React và nạp qua Server Action. Hai cái sai:
 *   · `ChonSoDong` — bộ chọn số dòng dùng chung của repo — hoạt động bằng cách đổi `?size=`
 *     trên URL, nên nó không thể nói chuyện với một trang giữ state trong bộ nhớ;
 *   · làm mới trang là mất chỗ đang đứng, và không gửi được đường dẫn cho người khác xem
 *     đúng cái mình đang xem.
 * Nay mọi điều kiện nằm trên URL (`?nguong=`, `?cs=`, `?page=`, `?size=`) — đúng nếp `/leads`.
 */
export default async function LeadNguoiPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  // Trạng thái "không có quyền" là màn hạng nhất ở hệ này (DESIGN.md §5) — nói rõ thiếu
  // quyền nào và hỏi ai, chứ không đá về dashboard cho người dùng tự đoán.
  if (!(await checkPermission("leads:assign"))) {
    return (
      <div className="mx-auto w-full max-w-[560px] px-4 py-16 text-center">
        <h1 className="text-lg font-semibold">Bạn chưa có quyền xem trang này</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Trang này cần quyền <b className="text-foreground">phân công lead</b> (
          <code className="rounded bg-muted px-1 py-0.5 text-xs">leads:assign</code>) — thường
          chỉ Quản lý cơ sở và Quản trị hệ thống mới có. Cần dùng thì nhờ quản trị hệ thống cấp
          quyền giúp.
        </p>
      </div>
    );
  }

  const sp = await searchParams;
  const mot = (k: string) => {
    const v = sp[k];
    return Array.isArray(v) ? v[0] : v;
  };
  const nguongNgay = chuanNguong(mot("nguong"));
  const soDong = docSoDong(sp.size);
  const trangXin = Math.max(1, Number(mot("page")) || 1);
  const centerId = mot("cs") || null;

  const actor = await resolveActor(session.user.id);
  const visibleCenterIds = getModelVisibleCenterIds("Lead", actor);
  const now = new Date();

  const [kq, coSo, saleList] = await Promise.all([
    timLeadNguoi({
      now,
      nguongNgay,
      visibleCenterIds,
      centerId,
      trang: trangXin,
      soDong,
    }),
    scopedDb(actor).center.findMany({
      where: { isActive: true },
      select: { id: true, name: true, code: true },
      orderBy: { code: "asc" },
    }),
    // Người có thể nhận. `centerId` đi kèm để màn hình LỌC theo cơ sở của lead — chủ dự án
    // chốt 16/09: lead ở cơ sở nào thì chia lại trong cơ sở đó, không chia qua cơ sở khác.
    // Server vẫn gác lại lần nữa (`canManualAssign` trong `nguoi-service.ts`); danh sách ở
    // đây chỉ để người dùng không chọn được một lựa chọn sẽ bị từ chối.
    scopedDb(actor).user.findMany({
      where: { isActive: true, deletedAt: null, roles: { has: "SALES_CSM" } },
      select: { id: true, name: true, email: true, centerId: true },
      orderBy: { name: "asc" },
    }),
  ]);

  return (
    <BangLeadNguoi
      tong={kq.tong}
      dong={kq.dong}
      trang={kq.trang}
      soTrang={kq.soTrang}
      soDong={soDong}
      quetThieu={kq.quetThieu}
      nguong={nguongNgay}
      centerId={centerId ?? ""}
      coSo={coSo.map((c) => ({ id: c.id, ten: c.name, ma: c.code ?? "—" }))}
      nguoiNhan={saleList.map((u) => ({
        id: u.id,
        ten: u.name ?? u.email ?? "(không tên)",
        centerId: u.centerId,
      }))}
    />
  );
}
