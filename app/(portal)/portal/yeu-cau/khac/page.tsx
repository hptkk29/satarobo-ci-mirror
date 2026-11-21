import { redirect } from "next/navigation";
import { isPortalV2Enabled } from "@/lib/flags";
import { KhungYeuCau } from "@/components/portal/yeu-cau/khung-yeu-cau";
import { FormYeuCauLoai } from "@/components/portal/yeu-cau/form-yeu-cau-loai";
import { docTuyChon } from "../_lib-tuy-chon";

export const dynamic = "force-dynamic";
export const metadata = { title: "Yêu cầu khác | Sata Robo", robots: { index: false } };

// Màn «Yêu cầu khác» của «Gửi yêu cầu đến trung tâm» (board M-Yeu-cau-khac). Yêu cầu chỉ là bản ghi để trung tâm xử lý.
export default async function Page() {
  // Các màn mới dùng token giao diện v2; v1 giữ trang Yêu cầu cũ ở /portal/yeu-cau.
  if (!isPortalV2Enabled()) redirect("/portal/yeu-cau");
  const t = await docTuyChon("khac");
  return (
    <KhungYeuCau tieuDe="Yêu cầu khác" moTa="Việc khác cần trung tâm hỗ trợ. Trung tâm phản hồi trong giờ làm việc.">
      <FormYeuCauLoai slug="khac" tuyChon={t} />
    </KhungYeuCau>
  );
}
