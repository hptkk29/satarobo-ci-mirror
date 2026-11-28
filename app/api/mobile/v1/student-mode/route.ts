import { chayDaDangNhap, traThanhCong } from "@/lib/mobile-api/cong";
import { layTrangThai } from "@/lib/mobile-api/che-do-hoc-sinh";

export const dynamic = "force-dynamic";

/** GET /api/mobile/v1/student-mode — phiên này đang ở chế độ học sinh không (và của học viên nào), ba mẹ đã có mã thoát chưa. Đọc được cả khi đang ở chế độ học sinh. */
export async function GET(req: Request) {
  return chayDaDangNhap(req, async (nguoi) => traThanhCong(await layTrangThai(nguoi)));
}
