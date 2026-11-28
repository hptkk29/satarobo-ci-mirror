import { docNhatKyCheDo } from "@/lib/mobile-api/che-do-hoc-sinh";
import { chayChoPhuHuynh, traThanhCong } from "@/lib/mobile-api/cong";

export const dynamic = "force-dynamic";

/** GET /api/mobile/v1/student-mode/log — nhật ký vào/thoát chế độ học sinh của CHÍNH phụ huynh (V8.19, B-ST2). Chỉ-đọc, ≤ 30 dòng mới nhất, không mã/mật khẩu. Chế độ học sinh ⇒ 403. */
export async function GET(req: Request) {
  return chayChoPhuHuynh(req, async (nguoi) => traThanhCong(await docNhatKyCheDo(nguoi)));
}
