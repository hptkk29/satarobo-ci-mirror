import { chayChoPhuHuynh, chayChoPhuHuynhCoThan, traThanhCong } from "@/lib/mobile-api/cong";
import { docYeuCauXoa, guiYeuCauXoa, yeuCauXoaSchema } from "@/lib/mobile-api/dich-vu/yeu-cau-xoa-tai-khoan";

export const dynamic = "force-dynamic";

/** GET /api/mobile/v1/account/deletion-request — yêu cầu xoá tài khoản ĐANG MỞ của chính người dùng `{maYeuCau, tiepNhanLuc}`, hoặc `null`. */
export async function GET(req: Request) {
  return chayChoPhuHuynh(req, async (nguoi) => traThanhCong(await docYeuCauXoa(nguoi)));
}

/** POST /api/mobile/v1/account/deletion-request `{matKhau, lyDo?}` → `{maYeuCau, tiepNhanLuc, daCoTruocDo}` — CHỈ ghi nhận (không xoá/ẩn danh/thu hồi phiên); đòi nhập lại mật khẩu. */
export async function POST(req: Request) {
  return chayChoPhuHuynhCoThan(req, yeuCauXoaSchema, async (nguoi, ctx, than) => traThanhCong(await guiYeuCauXoa(nguoi, than, ctx.now)));
}
