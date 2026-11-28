import { QuayLai, Khoi, TrangQuanTri } from "../../_components/ui/trang";
import { TieuDeTrang as PageHeader } from "@/app/(elearning)/elearning/_components/ui/tieu-de-trang";
import { docDanhSachKhoa } from "@/lib/elearning-online/doc";
import { vaoTrangOnline } from "../_lib/vao";
import { SapXepKhoa } from "../_components/sap-xep-khoa";

/** Sắp thứ tự hiển thị khoá Online trên trang công khai. Quyền `onl:course:manage`. */
export const dynamic = "force-dynamic";
export const metadata = { title: "Sắp thứ tự khoá online | Sata Robo", robots: { index: false, follow: false } };

export default async function Page() {
  const v = await vaoTrangOnline("onl:course:manage", "Sắp thứ tự khoá online");
  if ("chan" in v) return v.chan;
  const kq = await docDanhSachKhoa({ coTrang: 100 });
  return (
    <TrangQuanTri rong="hep">
      <QuayLai href="/elearning/online">Khoá online</QuayLai>
      <PageHeader title="Sắp thứ tự hiển thị" subtitle="STT là thứ tự khoá trên trang Khoá học online của public site." />
      <Khoi sat>
        <SapXepKhoa khoa={kq.dong.map((k) => ({ id: k.id, code: k.code, name: k.name }))} />
      </Khoi>
    </TrangQuanTri>
  );
}
