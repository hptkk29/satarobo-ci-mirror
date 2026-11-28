import { z } from "zod";

import { chayChoPhuHuynhCoThan, traThanhCong } from "@/lib/mobile-api/cong";
import { chanNeuDiscTat, xacNhanPinSo } from "@/lib/mobile-api/dich-vu/disc";

export const dynamic = "force-dynamic";

/**
 * POST /api/mobile/v1/parent/disc/pin/verify — MỞ KHOÁ sổ DISC bằng `{pin}` HOẶC `{matKhau}` (mật khẩu cũng gỡ khoá PIN). Thành công ⇒ máy chủ tạo phiên mở khoá GẮN phiên đăng nhập này
 * (không có token mở khoá phía client). Sai nhiều lần ⇒ 429 + Retry-After. Thoát «chế độ trẻ em» = gọi lại endpoint này.
 */
export async function POST(req: Request) {
  const tat = chanNeuDiscTat();
  if (tat) return tat;
  return chayChoPhuHuynhCoThan(req, z.unknown(), async (nguoi, _ctx, than) => traThanhCong(await xacNhanPinSo(nguoi, than)));
}
