import { QuayLai, Khoi, TrangQuanTri } from "../../_components/ui/trang";
import { TieuDeTrang as PageHeader } from "@/app/(elearning)/elearning/_components/ui/tieu-de-trang";
import { can } from "@/lib/auth/can";
import { docDanhMuc } from "@/lib/elearning-online/doc";
import { vaoTrangOnline } from "../_lib/vao";
import { DanhMucQuanLy } from "../_components/danh-muc-quan-ly";

/** QoDanhMuc — DANH MỤC KHOÁ ONLINE (2 cấp). Xem: `onl:course:view`; thêm/đổi/xoá: `onl:course:manage`. */
export const dynamic = "force-dynamic";
export const metadata = { title: "Danh mục khoá online | Sata Robo", robots: { index: false, follow: false } };

export default async function Page() {
  const v = await vaoTrangOnline("onl:course:view", "Danh mục khoá online");
  if ("chan" in v) return v.chan;
  const ds = await docDanhMuc();
  return (
    <TrangQuanTri rong="hep">
      <QuayLai href="/elearning/online">Khoá online</QuayLai>
      <PageHeader title="Danh mục khoá" subtitle="Hai cấp: danh mục cha và danh mục con. Dùng để lọc khoá trên public site." />
      <Khoi sat>
        <DanhMucQuanLy dong={ds.map((d) => ({ id: d.id, name: d.name, parentId: d.parentId, soKhoa: d._count.courses }))} coQuyen={can(v.actor, "onl:course:manage")} />
      </Khoi>
    </TrangQuanTri>
  );
}
