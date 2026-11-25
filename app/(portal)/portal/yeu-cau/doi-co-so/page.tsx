import { redirect } from "next/navigation";
import { isPortalV2Enabled } from "@/lib/flags";
import { KhungYeuCau } from "@/components/portal/yeu-cau/khung-yeu-cau";
import { FormYeuCauLoai } from "@/components/portal/yeu-cau/form-yeu-cau-loai";
import { docTuyChon } from "../_lib-tuy-chon";

export const dynamic = "force-dynamic";
export const metadata = { title: "Chuyển cơ sở | Sata Robo", robots: { index: false } };

// Màn «Chuyển cơ sở» của «Gửi yêu cầu đến trung tâm» (board M-Yeu-cau-doi-co-so). Yêu cầu chỉ là bản ghi để trung tâm xử lý.
export default async function Page() {
  // Các màn mới dùng token giao diện v2; v1 giữ trang Yêu cầu cũ ở /portal/yeu-cau.
  if (!isPortalV2Enabled()) redirect("/portal/yeu-cau");
  const t = await docTuyChon("doi-co-so");
  return (
    <KhungYeuCau tieuDe="Chuyển cơ sở" moTa="Đề nghị chuyển con sang học ở cơ sở khác của trung tâm.">
      <FormYeuCauLoai slug="doi-co-so" tuyChon={t} />
    </KhungYeuCau>
  );
}
