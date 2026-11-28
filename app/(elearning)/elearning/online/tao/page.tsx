import { QuayLai, Khoi, TrangQuanTri } from "../../_components/ui/trang";
import { TieuDeTrang as PageHeader } from "@/app/(elearning)/elearning/_components/ui/tieu-de-trang";
import { docDanhMuc } from "@/lib/elearning-online/doc";
import { vaoTrangOnline } from "../_lib/vao";
import { FormKhoa } from "../_components/form-khoa";

/** QoTao — TẠO KHOÁ ONLINE. Tạo xong có sẵn bản nháp số 1; chưa bán, chưa phát hành. */
export const dynamic = "force-dynamic";
export const metadata = { title: "Tạo khoá online | Sata Robo", robots: { index: false, follow: false } };

export default async function Page() {
  const v = await vaoTrangOnline("onl:course:manage", "Tạo khoá online");
  if ("chan" in v) return v.chan;
  const danhMuc = await docDanhMuc();
  return (
    <TrangQuanTri rong="hep">
      <QuayLai href="/elearning/online">Khoá online</QuayLai>
      <PageHeader title="Tạo khoá online" subtitle="Nhập thông tin và giá. Sau khi tạo, soạn chương và bài trong bản nháp rồi phát hành." />
      <Khoi>
        <FormKhoa cheDo="tao" danhMuc={danhMuc.map((d) => ({ id: d.id, name: d.name, parentId: d.parentId }))} />
      </Khoi>
    </TrangQuanTri>
  );
}
