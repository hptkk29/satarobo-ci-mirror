// app/(admin)/admin/bao-cao/trial/page.tsx — ĐÃ GỠ 23/09/2026.
//
// Chủ dự án: "xoá bỏ màn /bao-cao/trial, lấy màn /bao-cao/trial-sale làm màn chính cho báo
// cáo trải nghiệm". Màn cũ thống kê theo CƠ SỞ (sĩ số lấp đầy, dự đủ buổi) — số đó đo lớp
// slot kiểu cũ, lớp mở theo khung từ 22/09 không còn "sĩ số" để lấp. Màn theo Sale đếm
// đúng đơn vị việc bây giờ: CASE.
//
// Giữ đường dẫn, chỉ chuyển tiếp: link đã lưu / đã gửi Zalo không thành trang 404. Chuyển
// kèm bộ lọc cơ sở — khoảng ngày của hai màn khác tên tham số và khác nghĩa (màn cũ lọc
// theo ngày tạo LỚP, màn mới theo ngày tạo CASE), nên cố ý KHÔNG chép ngày sang.
import { redirect } from "next/navigation";

export default async function BaoCaoTrialCuPage({
  searchParams,
}: {
  searchParams: Promise<{ centerId?: string }>;
}) {
  const { centerId } = await searchParams;
  redirect(centerId ? `/bao-cao/trial-sale?centerId=${encodeURIComponent(centerId)}` : "/bao-cao/trial-sale");
}
