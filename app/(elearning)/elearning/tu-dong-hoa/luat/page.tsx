import Link from "next/link";
import { auth } from "@/lib/auth";
import { resolveActor } from "@/lib/auth/actor";
import { can } from "@/lib/auth/can";
import { scopedDb } from "@/lib/db-scope";
import { EmptyState, NoPermission } from "@/components/admin/ui/states";
import { TieuDeTrang as PageHeader } from "@/app/(elearning)/elearning/_components/ui/tieu-de-trang";
import { QuayLai, TrangQuanTri } from "../../_components/ui/trang";
import { LIEN_KET_CHU } from "../../_components/ui/dieu-khien";
import { napDuLieuForm } from "../_lib/du-lieu-form";
import { RuleForm } from "../_components/rule-form";

/**
 * P7 — KHAI LUẬT MỚI (thiết kế `QtLuatMoi`, route `/tu-dong-hoa/luat`): Khi → điều kiện → thì, và "Chạy thử trên dữ liệu 7 ngày" (chỉ đọc).
 * Luật mới LUÔN lưu ở trạng thái TẮT (server ép — `cauHinhKhaiLuat`); bật ở danh sách.
 */
export const dynamic = "force-dynamic";
export const metadata = { title: "Khai luật mới | Sata Robo", robots: { index: false, follow: false } };

export default async function Page() {
  const session = await auth();
  if (!session?.user?.id) {
    return (
      <TrangQuanTri rong="hep">
        <EmptyState title="Chưa đăng nhập" description="Đăng nhập rồi mở lại trang này." />
      </TrangQuanTri>
    );
  }
  const actor = await resolveActor(session.user.id);
  if (!can(actor, "elearning:program:manage")) {
    return (
      <TrangQuanTri rong="hep">
        <PageHeader title="Khai luật mới" />
        <NoPermission permission="elearning:program:manage" what="khai luật tự động hoá" askWho="phòng Đào tạo" />
        <Link href="/elearning/tu-dong-hoa" className={`${LIEN_KET_CHU} inline-flex min-h-8 items-center`}>
          Về Tự động hoá
        </Link>
      </TrangQuanTri>
    );
  }
  const du = await napDuLieuForm(scopedDb(actor));
  return (
    <TrangQuanTri rong="vua">
      <QuayLai href="/elearning/tu-dong-hoa">Tự động hoá</QuayLai>
      <PageHeader title="Khai luật mới" subtitle="Khi → điều kiện → hành động. Luật mới luôn lưu ở trạng thái tắt; bật sau khi chạy thử." />
      <RuleForm trang khoa={du.khoa} loTrinh={du.loTrinh} phongBan={du.phongBan} />
    </TrangQuanTri>
  );
}
