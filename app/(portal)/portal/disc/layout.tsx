import type { ReactNode } from "react";

import { chanKhiOCheDoHocSinh } from "@/lib/portal/session";
import "@/components/disc-portal/so/disc-so.css";

/**
 * Khung chung của khu «Khám phá DISC» trong cổng phụ huynh: chỉ gắn lớp `.disc-scope` (token màu D/I/S/C, sáng + tối).
 * Không gác quyền ở đây — từng page/route tự gọi `yeuCauPhienDisc()`/`docPhienDisc()` (layout không chạy lại khi điều hướng mềm).
 */
export default async function DiscLayout({ children }: { children: ReactNode }) {
  // Cổng học sinh: khu DISC của ba mẹ — con đang ở chế độ học sinh bị đá về /portal/hoc-sinh (lưới: components/portal/hv-che-do-phu-huynh.test.ts).
  await chanKhiOCheDoHocSinh();
  return <div className="disc-scope">{children}</div>;
}
