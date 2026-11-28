import { taoMaSchema, taoMaThoat } from "@/lib/mobile-api/che-do-hoc-sinh";
import { chayChoPhuHuynhCoThan, traThanhCong } from "@/lib/mobile-api/cong";

export const dynamic = "force-dynamic";

/** POST /api/mobile/v1/student-mode/code { ma, xacNhan } — LẦN ĐẦU tạo mã thoát 4 số (đã có mã ⇒ 409). Chỉ ở phiên phụ huynh; mã dễ đoán bị từ chối như web. */
export async function POST(req: Request) {
  return chayChoPhuHuynhCoThan(req, taoMaSchema, async (nguoi, _ctx, thanDl) => traThanhCong(await taoMaThoat(nguoi, thanDl.ma, thanDl.xacNhan)));
}
