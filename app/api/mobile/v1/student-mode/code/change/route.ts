import { doiMaSchema, doiMaThoat } from "@/lib/mobile-api/che-do-hoc-sinh";
import { chayChoPhuHuynhCoThan, traThanhCong } from "@/lib/mobile-api/cong";

export const dynamic = "force-dynamic";

/** POST /api/mobile/v1/student-mode/code/change { maCu, ma, xacNhan } — ĐỔI mã thoát 4 số (V8.19, B-ST2). Cùng luật web: mã hiện tại qua bộ đếm sai/khoá chung, mã mới khác mã cũ + không dễ đoán. Chỉ ở phiên phụ huynh. */
export async function POST(req: Request) {
  return chayChoPhuHuynhCoThan(req, doiMaSchema, async (nguoi, _ctx, thanDl) => traThanhCong(await doiMaThoat(nguoi, thanDl)));
}
