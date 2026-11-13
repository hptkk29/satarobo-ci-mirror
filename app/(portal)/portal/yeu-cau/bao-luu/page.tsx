import { redirect } from "next/navigation";
import { isPortalV2Enabled } from "@/lib/flags";
import { KhungYeuCau } from "@/components/portal/yeu-cau/khung-yeu-cau";
import { FormYeuCauLoai } from "@/components/portal/yeu-cau/form-yeu-cau-loai";
import { docTuyChon } from "../_lib-tuy-chon";

export const dynamic = "force-dynamic";
export const metadata = { title: "Bảo lưu | Sata Robo", robots: { index: false } };

// Màn «Bảo lưu» của «Gửi yêu cầu đến trung tâm» (board M-Yeu-cau-bao-luu). Yêu cầu chỉ là bản ghi để trung tâm xử lý.
export default async function Page() {
  // Các màn mới dùng token giao diện v2; v1 giữ trang Yêu cầu cũ ở /portal/yeu-cau.
  if (!isPortalV2Enabled()) redirect("/portal/yeu-cau");
  const t = await docTuyChon("bao-luu");
  return (
    <KhungYeuCau tieuDe="Bảo lưu" moTa="Tạm dừng khoá học và giữ lại học phí còn lại. Trung tâm lập hồ sơ sau khi nhận yêu cầu.">
      <FormYeuCauLoai slug="bao-luu" tuyChon={t} />
    </KhungYeuCau>
  );
}
