import { chayChoPhuHuynh, traThanhCong } from "@/lib/mobile-api/cong";
import { layTuSach } from "@/lib/mobile-api/dich-vu/tu-sach";

export const dynamic = "force-dynamic";

/** GET /api/mobile/v1/parent/library — «Tủ sách cho ba mẹ»: 20 ebook + trạng thái điều kiện tải của phụ huynh trong PHIÊN. Cờ TU_SACH_ENABLED TẮT ⇒ 404; phiên chế độ học sinh ⇒ 403. Không theo học viên. */
export async function GET(req: Request) {
  return chayChoPhuHuynh(req, async (nguoi) => traThanhCong(await layTuSach(nguoi)));
}
