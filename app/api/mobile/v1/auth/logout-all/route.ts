import { chayDaDangNhapCoThan, traThanhCong } from "@/lib/mobile-api/cong";
import { dangXuatTatCa, dangXuatTatCaSchema } from "@/lib/mobile-api/dich-vu/phien-dang-nhap";

export const dynamic = "force-dynamic";

/** POST /api/mobile/v1/auth/logout-all `{giuPhienHienTai?: boolean}` → `{soPhienThuHoi, giuPhienHienTai}` — đăng xuất MỌI thiết bị (mặc định gồm cả thiết bị này; `giuPhienHienTai:true` ⇒ chỉ các thiết bị khác). (SEC-05) */
export async function POST(req: Request) {
  return chayDaDangNhapCoThan(req, dangXuatTatCaSchema, async (nguoi, ctx, than) => traThanhCong(await dangXuatTatCa(nguoi, than, ctx)));
}
