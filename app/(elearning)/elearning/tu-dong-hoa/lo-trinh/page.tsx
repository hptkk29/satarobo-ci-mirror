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
import { PathForm } from "../_components/path-form";

/** P7 — SOẠN LỘ TRÌNH (thiết kế `QtLoTrinh`, route `/tu-dong-hoa/lo-trinh`): danh sách khoá THEO THỨ TỰ, học tuần tự hay không. */
export const dynamic = "force-dynamic";
export const metadata = { title: "Soạn lộ trình | Sata Robo", robots: { index: false, follow: false } };

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
        <PageHeader title="Soạn lộ trình" />
        <NoPermission permission="elearning:program:manage" what="soạn lộ trình" askWho="phòng Đào tạo" />
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
      <PageHeader title="Soạn lộ trình" subtitle="Chuỗi khoá giao theo thứ tự; luật có thể giao trọn một lộ trình." />
      <PathForm trang khoa={du.khoa} />
    </TrangQuanTri>
  );
}
