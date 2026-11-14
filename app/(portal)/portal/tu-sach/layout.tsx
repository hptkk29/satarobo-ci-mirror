import type { ReactNode } from "react";

import { chanKhiOCheDoHocSinh } from "@/lib/portal/session";

/**
 * Khung của «Tủ sách gia đình» trong cổng phụ huynh. Không gác quyền ở đây — page/route tự gọi `yeuCauPhienMienPhi`/`docPhienMienPhi`
 * (layout không chạy lại khi điều hướng mềm). Chỉ đá con đang ở chế độ học sinh về cổng học sinh (lưới: components/portal/hv-che-do-phu-huynh.test.ts).
 */
export default async function TuSachLayout({ children }: { children: ReactNode }) {
  await chanKhiOCheDoHocSinh();
  return <>{children}</>;
}
