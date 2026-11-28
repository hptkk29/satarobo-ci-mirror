import { z } from "zod";

import { chayChoPhuHuynh, chayChoPhuHuynhCoThan, traThanhCong } from "@/lib/mobile-api/cong";
import { chanNeuDiscTat, datPinSo, docTrangThaiPinSo } from "@/lib/mobile-api/dich-vu/disc";

export const dynamic = "force-dynamic";

/**
 * GET /api/mobile/v1/parent/disc/pin — TRẠNG THÁI PIN tối thiểu: `{coSo, coPin, epMayChu, daMoKhoa, cheDo, khoaDenLuc, hetHanTuyetDoiLuc, idleGiay}`.
 * KHÔNG chứa dữ liệu DISC (tên gia đình / thành viên / điểm). Dùng để quyết định hiện màn «Nhập PIN» hay vào thẳng.
 */
export async function GET(req: Request) {
  const tat = chanNeuDiscTat();
  if (tat) return tat;
  return chayChoPhuHuynh(req, async (nguoi) => traThanhCong(await docTrangThaiPinSo(nguoi)));
}

/**
 * POST /api/mobile/v1/parent/disc/pin — ĐẶT lần đầu `{pin}` (chỉ cần đăng nhập + chủ sổ) hoặc ĐỔI `{pin, pinCu}` | `{pin, matKhau}`.
 * Thân do domain kiểm CHẶT (khoá lạ như `pinVerified` ⇒ 400). Đã có PIN mà thiếu bằng chứng ⇒ 400 `maChiTiet:"CAN_PIN_CU_HOAC_MAT_KHAU"`; PIN đang khoá ⇒ chỉ `matKhau`.
 */
export async function POST(req: Request) {
  const tat = chanNeuDiscTat();
  if (tat) return tat;
  return chayChoPhuHuynhCoThan(req, z.unknown(), async (nguoi, _ctx, than) => traThanhCong(await datPinSo(nguoi, than)));
}
