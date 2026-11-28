import { notFound } from "next/navigation";
import { EmptyState } from "@/components/admin/ui/states";
import { TieuDeTrang as PageHeader } from "@/app/(elearning)/elearning/_components/ui/tieu-de-trang";
import { QuayLai, Khoi, TrangQuanTri } from "../../../../_components/ui/trang";
import { docChiTietKhoa } from "@/lib/elearning-online/doc";
import { vaoTrangOnline } from "../../../_lib/vao";
import { PhatHanhWizard } from "../../../_components/phat-hanh-wizard";

/** QoPhatHanh1–3 — phát hành bản nháp của một khoá. Quyền `onl:course:release`. */
export const dynamic = "force-dynamic";
export const metadata = { title: "Phát hành phiên bản | Sata Robo", robots: { index: false, follow: false } };

export default async function Page({ params }: { params: Promise<{ courseId: string }> }) {
  const v = await vaoTrangOnline("onl:course:release", "Phát hành phiên bản");
  if ("chan" in v) return v.chan;
  const { courseId } = await params;
  const khoa = await docChiTietKhoa(courseId);
  if (!khoa) notFound();
  const coNhap = khoa.versions.some((x) => x.status === "DRAFT");
  return (
    <TrangQuanTri rong="vua">
      <QuayLai href={`/elearning/online/khoa/${courseId}`}>{khoa.name}</QuayLai>
      <PageHeader title="Phát hành phiên bản" subtitle="So sánh, chọn chính sách tiến độ, xem tác động rồi xác nhận." />
      <Khoi>
        {coNhap ? (
          <PhatHanhWizard courseId={courseId} tenKhoa={khoa.name} laBanDauTien={!khoa.publishedVersionId} />
        ) : (
          <EmptyState title="Khoá chưa có bản nháp để phát hành" description="Mở bản nháp mới ở tab “Chương & bài”, chỉnh sửa rồi quay lại đây." />
        )}
      </Khoi>
    </TrangQuanTri>
  );
}
