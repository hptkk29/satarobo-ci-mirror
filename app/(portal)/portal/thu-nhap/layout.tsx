import { chanKhiOCheDoHocSinh } from "@/lib/portal/session";

// CỔNG CHẾ ĐỘ HỌC SINH: «Thu nhập thêm» là của BA MẸ. Con đang ở Cổng học sinh mà vào đây thì bị đá về /portal/hoc-sinh.
// Lưới canh đủ segment: components/portal/hv-che-do-phu-huynh.test.ts.
export default async function ChanCheDoHocSinhLayout({ children }: { children: React.ReactNode }) {
  await chanKhiOCheDoHocSinh();
  return children;
}
