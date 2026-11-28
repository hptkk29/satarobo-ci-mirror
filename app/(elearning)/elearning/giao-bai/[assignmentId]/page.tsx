import { auth } from "@/lib/auth";
import { resolveActor } from "@/lib/auth/actor";
import { can } from "@/lib/auth/can";
import { scopedDb } from "@/lib/db-scope";
import { napChiTietLuotGiao } from "@/lib/elearning/luot-giao-view";
import { thongKeLuotGiao } from "@/lib/elearning/luot-giao-thong-ke";
import { TieuDeTrang as PageHeader } from "@/app/(elearning)/elearning/_components/ui/tieu-de-trang";
import { EmptyState, NoPermission } from "@/components/admin/ui/states";
import { GhiChu, QuayLai, TrangQuanTri } from "../../_components/ui/trang";
import { LuotGiaoChiTiet } from "../_components/luot-giao-chi-tiet";

/**
 * CHI TIẾT MỘT LƯỢT GIAO — người nhận + trạng thái, chọn nhiều để gia hạn / thu hồi hàng loạt.
 * Quyền xem: `elearning:assignment:create` (cùng màn giao khoá); từng nút hàng loạt theo quyền riêng của action
 * (`assignment:extend` / `assignment:create`) — vẽ nút khi người xem có quyền, server vẫn là bên từ chối.
 */
export const dynamic = "force-dynamic";

export const metadata = {
  title: "Lượt giao | Sata Robo",
  robots: { index: false, follow: false },
};

export default async function Page({ params }: { params: Promise<{ assignmentId: string }> }) {
  const { assignmentId } = await params;
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
        <NoPermission permission="elearning:assignment:create" what="màn lượt giao" askWho="phòng Đào tạo" />
      </TrangQuanTri>
    );
  }

  const d = await napChiTietLuotGiao(scopedDb(actor), assignmentId);
  if (!d) {
    return (
      <TrangQuanTri rong="hep">
        <QuayLai href="/elearning/giao-bai">Giao khoá</QuayLai>
        <EmptyState title="Không tìm thấy lượt giao" description="Lượt giao không tồn tại hoặc không thuộc phạm vi của bạn." />
      </TrangQuanTri>
    );
  }

  const tk = thongKeLuotGiao(d.dong);
  const han = d.luot.dueAt ? new Intl.DateTimeFormat("vi-VN", { day: "2-digit", month: "2-digit", timeZone: "Asia/Ho_Chi_Minh" }).format(new Date(d.luot.dueAt)) : null;
  return (
    <TrangQuanTri rong="rong">
      <QuayLai href="/elearning/luot-giao">Lượt giao</QuayLai>
      <PageHeader
        title={d.luot.title}
        subtitle={[
          d.luot.tenKhoa,
          `${d.dong.length}${d.biCat ? "+" : ""} người nhận`,
          han ? `hạn ${han}` : null,
          d.luot.isMandatory ? "bắt buộc" : null,
          d.luot.status === "REVOKED" ? "đã đóng" : null,
        ]
          .filter(Boolean)
          .join(" · ")}
      />
      {/* Ba ô thống kê theo thiết kế — đếm từ chính các dòng ở bảng bên dưới (xem `thongKeLuotGiao`). */}
      <dl aria-label="Thống kê lượt giao" className="grid grid-cols-3 border-y border-border py-4 text-sm">
        {[
          ["Đã xong", tk.daXong, "text-state-success-ink"],
          ["Trễ", tk.tre, "text-state-danger-ink"],
          ["Đã thu hồi", tk.thuHoi, "text-foreground"],
        ].map(([nhan, so, mau]) => (
          <div key={nhan as string} className="px-3 first:pl-0">
            <dt className="text-muted-foreground">{nhan}</dt>
            <dd className={`text-3xl font-semibold tabular-nums ${mau}`}>{so}</dd>
          </div>
        ))}
      </dl>
      {d.biCat ? (
        <GhiChu sac="warning" tieuDe="Chỉ hiển thị 500 người đầu">
          Lượt giao có nhiều hơn 500 người nhận; thao tác hàng loạt chỉ áp cho người đang hiển thị.
        </GhiChu>
      ) : null}
      {d.dong.length === 0 ? (
        <EmptyState title="Chưa có người nhận nào trong tầm nhìn của bạn" description="Lượt giao chưa có ghi danh, hoặc người nhận thuộc cơ sở khác." />
      ) : (
        <LuotGiaoChiTiet
          assignmentId={d.luot.id}
          dong={d.dong}
          coQuyenGiaHan={can(actor, "elearning:assignment:extend")}
          coQuyenThuHoi={can(actor, "elearning:assignment:create")}
        />
      )}
    </TrangQuanTri>
  );
}
