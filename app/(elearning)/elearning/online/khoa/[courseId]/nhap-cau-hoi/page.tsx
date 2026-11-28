import { notFound } from "next/navigation";
import { TieuDeTrang as PageHeader } from "@/app/(elearning)/elearning/_components/ui/tieu-de-trang";
import { QuayLai, Khoi, TrangQuanTri } from "../../../../_components/ui/trang";
import { docChiTietKhoa, docDeThiKhoa } from "@/lib/elearning-online/doc";
import { PhanTrangBang } from "@/components/ui/phan-trang-bang";
import { MAU_THEO_LOAI, NHAN_LOAI_NHAP, TOI_DA_DONG, type LoaiNhap } from "@/lib/elearning-online/nhap-cau-hoi";
import { vaoTrangOnline } from "../../../_lib/vao";
import { NhapCauHoiForm } from "../../../_components/nhap-cau-hoi-form";

/** QoImport — nhập câu hỏi từ Excel vào ngân hàng câu hỏi của MỘT khoá online (tuỳ chọn gắn luôn vào một đề). Quyền `onl:assessment:manage`. */
export const dynamic = "force-dynamic";
export const metadata = { title: "Import câu hỏi từ Excel | Sata Robo", robots: { index: false, follow: false } };

/** Thứ tự hàng theo thiết kế QoImport (khác thứ tự sheet trong tệp mẫu). */
const THU_TU: LoaiNhap[] = ["SINGLE_CHOICE", "MULTIPLE_CHOICE", "TRUE_FALSE", "FILL_BLANK", "MATCHING", "ORDERING", "CLASSIFY", "IMAGE_HOTSPOT", "NUMERIC", "SHORT_TEXT", "ESSAY", "PRODUCT", "BLOCK_SEQUENCE"];
/** Cột "Kèm tệp": CHỈ nói thứ có thật. Thiết kế có tệp .zip kèm ảnh/.sb3 — chưa làm, nên không hứa. */
const KEM_TEP: Partial<Record<LoaiNhap, string>> = {
  IMAGE_HOTSPOT: "Ảnh ghi bằng đường dẫn (chưa nhận .zip)",
  BLOCK_SEQUENCE: "Sa bàn ghi trong ô (chưa nhận .sb3)",
};
const KIND: Record<string, string> = { QUIZ: "Kiểm tra", ASSIGNMENT: "Bài tập", FINAL_EXAM: "Thi cuối khoá" };

export default async function Page({ params }: { params: Promise<{ courseId: string }> }) {
  const v = await vaoTrangOnline("onl:assessment:manage", "Import câu hỏi từ Excel");
  if ("chan" in v) return v.chan;
  const { courseId } = await params;
  const [khoa, de] = await Promise.all([docChiTietKhoa(courseId), docDeThiKhoa(courseId)]);
  if (!khoa) notFound();
  const dich = de.filter((d) => d.status !== "ARCHIVED").map((d) => ({ id: d.id, ten: `${KIND[d.kind] ?? d.kind} · ${d.title}` }));
  const hang = THU_TU.map((l) => MAU_THEO_LOAI.find((m) => m.loai === l)!);
  return (
    <TrangQuanTri rong="vua">
      <QuayLai href={`/elearning/online/khoa/${courseId}?tab=kiem-tra`}>Kiểm tra &amp; thi</QuayLai>
      <PageHeader title="Import câu hỏi từ Excel" subtitle={`Vào: ${khoa.name} › Ngân hàng câu hỏi — có thể gắn thẳng vào một đề của khoá. Tối đa ${TOI_DA_DONG} câu mỗi lần.`} />
      <Khoi>
        <NhapCauHoiForm courseId={courseId} dich={dich} />
      </Khoi>
      <Khoi>
        <section aria-label="Mẫu theo từng dạng" className="rounded-xl border border-border bg-card">
          <header className="border-b border-border px-4 py-3">
            <h2 className="text-base font-semibold">Mẫu theo từng dạng ({MAU_THEO_LOAI.length})</h2>
            <p className="mt-1 text-sm text-muted-foreground">Mỗi dạng một sheet trong bộ mẫu (hoặc tải riêng từng dạng); dòng 1 là tiêu đề cột, từ dòng 2 là câu hỏi.</p>
          </header>
          <PhanTrangBang cuonNgang tenDonVi="dạng" soDongMacDinh={20}>
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-border text-xs text-muted-foreground">
                  <th scope="col" className="px-4 py-2 font-medium">Dạng câu</th>
                  <th scope="col" className="px-4 py-2 font-medium">Mẫu</th>
                  <th scope="col" className="px-4 py-2 font-medium">Cột bắt buộc</th>
                  <th scope="col" className="px-4 py-2 font-medium">Kèm tệp</th>
                </tr>
              </thead>
              <tbody>
                {hang.map((m) => (
                  <tr key={m.loai} className="border-b border-border last:border-0">
                    <td className="whitespace-nowrap px-4 py-2.5">{NHAN_LOAI_NHAP[m.loai]}</td>
                    <td className="whitespace-nowrap px-4 py-2.5">
                      <a className="font-medium text-primary underline underline-offset-2" href={`/api/elearning/online/mau-nhap-cau-hoi?dang=${m.loai}`} download aria-label={`Tải mẫu ${NHAN_LOAI_NHAP[m.loai]}`}>
                        {m.tepMau}
                      </a>
                    </td>
                    <td className="px-4 py-2.5">{m.cotBatBuoc}</td>
                    <td className="px-4 py-2.5 text-muted-foreground">{KEM_TEP[m.loai] ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </PhanTrangBang>
          <p className="border-t border-border px-4 py-3 text-sm text-muted-foreground">
            Đủ {MAU_THEO_LOAI.length} dạng câu hỏi. Toạ độ (cột, hàng) tính từ 1. Sheet có tên khác với bảng trên được báo &quot;bỏ qua&quot; trong kết quả kiểm tra và KHÔNG được nhập.
          </p>
        </section>
      </Khoi>
    </TrangQuanTri>
  );
}
