import { chayChoPhuHuynh, traThanhCong } from "@/lib/mobile-api/cong";
import { layRobotChoHocSinh } from "@/lib/mobile-api/dich-vu/robot-tinh-cach";

export const dynamic = "force-dynamic";

/**
 * GET /api/mobile/v1/student-mode/personality-robot — D1 (Owner 22/11/2026): «Robot tính cách» của CHÍNH học viên mà phiên đang khoá vào (chế độ học sinh). Không tham số: học viên lấy từ PHIÊN
 * (không có đường tới anh/chị/em). Kiểm quyền lại mỗi lần (còn thuộc phụ huynh của phiên, chưa xoá). KHÔNG dùng bằng chứng mở khoá PIN DISC của phụ huynh; chỉ trả DTO robot (không báo cáo thô).
 * Phiên phụ huynh (không ở chế độ học sinh) ⇒ 403 — phụ huynh dùng `/students/:id/personality-robot` (qua cổng PIN).
 */
export async function GET(req: Request) {
  return chayChoPhuHuynh(req, async (nguoi) => traThanhCong(await layRobotChoHocSinh(nguoi)));
}
