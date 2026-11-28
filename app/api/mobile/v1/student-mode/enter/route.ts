import { vaoCheDo, vaoSchema } from "@/lib/mobile-api/che-do-hoc-sinh";
import { chayTheoHocVienTrongThan, traThanhCong } from "@/lib/mobile-api/cong";

export const dynamic = "force-dynamic";

/** POST /api/mobile/v1/student-mode/enter { studentId } — khoá phiên này vào MỘT con của chính phụ huynh (con nhà khác ⇒ 404). Cần đã có mã thoát. Không dùng được khi đang ở chế độ học sinh. */
export async function POST(req: Request) {
  return chayTheoHocVienTrongThan(req, vaoSchema, (d) => d.studentId, async (hs, nguoi) => traThanhCong(await vaoCheDo(nguoi, hs)));
}
