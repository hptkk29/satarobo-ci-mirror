import { redirect } from "next/navigation";
import { isPortalV2Enabled } from "@/lib/flags";
import { KhungYeuCau } from "@/components/portal/yeu-cau/khung-yeu-cau";
import { FormYeuCauLoai } from "@/components/portal/yeu-cau/form-yeu-cau-loai";
import { docTuyChon } from "../_lib-tuy-chon";

export const dynamic = "force-dynamic";
export const metadata = { title: "Chuyển lớp | Sata Robo", robots: { index: false } };

// Màn «Chuyển lớp» của «Gửi yêu cầu đến trung tâm» (board M-Yeu-cau-doi-lop). Yêu cầu chỉ là bản ghi để trung tâm xử lý.
export default async function Page() {
  // Các màn mới dùng token giao diện v2; v1 giữ trang Yêu cầu cũ ở /portal/yeu-cau.
  if (!isPortalV2Enabled()) redirect("/portal/yeu-cau");
  const t = await docTuyChon("doi-lop");
  return (
    <KhungYeuCau tieuDe="Chuyển lớp" moTa="Đổi sang lớp cùng khoá nhưng khác giờ học. Giáo vụ sẽ gợi ý lớp phù hợp và báo lại.">
      <FormYeuCauLoai slug="doi-lop" tuyChon={t} />
    </KhungYeuCau>
  );
}
