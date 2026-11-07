import { chanKhiOCheDoHocSinh } from "@/lib/portal/session";

// CỔNG CHẾ ĐỘ HỌC SINH: trang này là của BA MẸ. Con đang ở Cổng học sinh (cookie portal_hv đã ký) mà vào đây thì bị đá về /portal/hoc-sinh.
// Đặt ở layout của SEGMENT vì layout gốc của portal không biết đường dẫn và không chạy lại khi điều hướng mềm giữa các trang.
// Lưới canh đủ segment: components/portal/hv-che-do-phu-huynh.test.ts.
export default async function ChanCheDoHocSinhLayout({ children }: { children: React.ReactNode }) {
  await chanKhiOCheDoHocSinh();
  return children;
}
