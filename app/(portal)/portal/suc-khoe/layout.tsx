import type { ReactNode } from "react";

import { chanKhiOCheDoHocSinh } from "@/lib/portal/session";

/**
 * Khung của «Sức khỏe cả nhà» trong cổng phụ huynh. Không gác quyền ở đây — page tự gọi `yeuCauPhienMienPhi` (layout không chạy lại khi điều hướng mềm).
 * Chỉ đá con đang ở chế độ học sinh về cổng học sinh (lưới: components/portal/hv-che-do-phu-huynh.test.ts).
 */
export default async function SucKhoeLayout({ children }: { children: ReactNode }) {
  await chanKhiOCheDoHocSinh();
  return <>{children}</>;
}
