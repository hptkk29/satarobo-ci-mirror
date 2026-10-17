// app/(admin)/admin/khuyen-mai/[id]/sua/page.tsx — SỬA một chính sách chưa thu hồi.
//
// Lựa chọn phạm vi = danh sách đang hoạt động ∪ những gì văn bản ĐÃ chọn: một khoá/cơ sở đã
// ngừng mà biến khỏi danh sách thì bấm Lưu là lặng lẽ xoá nó khỏi phạm vi — đổi nội dung văn bản
// mà người sửa không hề chạm vào.
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { PageHeader } from "@/components/admin/ui/page-header";
import { NoPermission } from "@/components/admin/ui/states";
import { auth } from "@/lib/auth";
import { checkPermission } from "@/lib/auth/check-permission";
import { docChinhSach, docLuaChonPhamVi } from "@/lib/khuyen-mai/chinh-sach";
import { FormChinhSach, type LuaChon } from "../../_components/form-chinh-sach";

export const dynamic = "force-dynamic";
export const metadata = { title: "Sửa khuyến mãi | Admin Sata Robo" };

function gop(dangCo: LuaChon[], daChon: { id: string; ma: string; ten: string }[]): LuaChon[] {
  const ids = new Set(dangCo.map((x) => x.id));
  return [...dangCo, ...daChon.filter((x) => !ids.has(x.id)).map((x) => ({ ...x, daNgung: true }))];
}

export default async function SuaKhuyenMaiPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!(await checkPermission("promotions:manage"))) {
    return (
      <div className="space-y-5">
        <PageHeader title="Sửa chính sách khuyến mãi" />
        <NoPermission what="màn sửa chính sách khuyến mãi" permission="promotions:manage" askWho="Ban lãnh đạo (Quản trị tối cao, Giám đốc)" />
      </div>
    );
  }
  const { id } = await params;
  const [cs, luaChon] = await Promise.all([docChinhSach(id), docLuaChonPhamVi()]);
  if (!cs) notFound();
  if (cs.thuHoiLuc) redirect(`/khuyen-mai/${id}`);

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <Link
        href={`/khuyen-mai/${id}`}
        className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden />
        {cs.maVanBan}
      </Link>
      <PageHeader title={`Sửa ${cs.maVanBan}`} subtitle={cs.ten} />
      <FormChinhSach
        id={cs.id}
        giaTriDau={{
          maVanBan: cs.maVanBan,
          ten: cs.ten,
          noiDungUuDai: cs.noiDungUuDai,
          dieuKien: cs.dieuKien ?? "",
          tuNgay: cs.tuNgay,
          denNgay: cs.denNgay,
          coSo: cs.coSo.map((c) => c.id),
          khoaHoc: cs.khoaHoc.map((k) => k.id),
          tep: cs.tep,
        }}
        coSo={gop(luaChon.coSo, cs.coSo)}
        khoaHoc={gop(luaChon.khoaHoc, cs.khoaHoc)}
      />
    </div>
  );
}
