// app/(admin)/admin/khuyen-mai/moi/page.tsx — BAN HÀNH chính sách khuyến mãi mới.
// Gác `promotions:manage` NGAY ở trang (không chỉ ở action): người chỉ có quyền xem mà vào được
// form rồi bấm mới bị từ chối là lời hứa suông (luật 12).
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { PageHeader } from "@/components/admin/ui/page-header";
import { NoPermission } from "@/components/admin/ui/states";
import { auth } from "@/lib/auth";
import { checkPermission } from "@/lib/auth/check-permission";
import { ngayVN } from "@/lib/format/thoi-gian-vn";
import { docLuaChonPhamVi } from "@/lib/khuyen-mai/chinh-sach";
import { FormChinhSach } from "../_components/form-chinh-sach";

export const dynamic = "force-dynamic";
export const metadata = { title: "Ban hành khuyến mãi | Admin Sata Robo" };

export default async function BanHanhKhuyenMaiPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!(await checkPermission("promotions:manage"))) {
    return (
      <div className="space-y-5">
        <PageHeader title="Ban hành chính sách khuyến mãi" />
        <NoPermission what="màn ban hành chính sách khuyến mãi" permission="promotions:manage" askWho="Ban lãnh đạo (Quản trị tối cao, Giám đốc)" />
      </div>
    );
  }
  const luaChon = await docLuaChonPhamVi();
  const homNay = ngayVN(new Date());

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <Link
        href="/khuyen-mai"
        className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden />
        Tất cả khuyến mãi
      </Link>
      <PageHeader
        title="Ban hành chính sách khuyến mãi"
        subtitle="Có hiệu lực theo ngày ngay khi bấm Ban hành, và người tra cứu trong phạm vi áp dụng nhận thông báo."
      />
      <FormChinhSach
        giaTriDau={{
          maVanBan: "",
          ten: "",
          noiDungUuDai: "",
          dieuKien: "",
          tuNgay: homNay,
          denNgay: "",
          coSo: [],
          khoaHoc: [],
          tep: null,
        }}
        coSo={luaChon.coSo}
        khoaHoc={luaChon.khoaHoc}
      />
    </div>
  );
}
