import { chanKhiOCheDoHocSinh } from "@/lib/portal/session";

// CỔNG CHẾ ĐỘ HỌC SINH: chuông thông báo là của BA MẸ (học phí, học bạ, khảo sát…). Con ở Cổng học sinh có trang "Tin mới cho em" riêng.
// Lưới canh đủ segment: components/portal/hv-che-do-phu-huynh.test.ts.
export default async function ChanCheDoHocSinhLayout({ children }: { children: React.ReactNode }) {
  await chanKhiOCheDoHocSinh();
  return children;
}
