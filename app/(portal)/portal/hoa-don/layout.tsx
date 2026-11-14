import { chanKhiOCheDoHocSinh } from "@/lib/portal/session";

// Segment `/portal/hoa-don` chỉ có route tải tệp `[hoaDonId]/tai-ve` (giao diện nằm ở mục «Hoá đơn» của trang Học phí).
// Layout này khai cổng chế độ học sinh cho lưới [HVC-01]; route handler KHÔNG đi qua layout nên tự gác chế độ học sinh trong
// `tai-ve/route.ts` (ca [HDPH-R2] «đang ở CHẾ ĐỘ HỌC SINH ⇒ 404»). Không có page ⇒ `/portal/hoa-don` trần là 404, đúng sự thật.
export default async function HoaDonLayout({ children }: { children: React.ReactNode }) {
  await chanKhiOCheDoHocSinh();
  return <>{children}</>;
}
