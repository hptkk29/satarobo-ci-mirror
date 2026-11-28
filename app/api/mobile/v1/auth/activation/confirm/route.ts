import { docThanJson, motMobileTat, nguCanhYeuCau, traLoi, traThanhCong } from "@/lib/mobile-api/cong";
import { kichHoatTaiKhoan, xacNhanSchema } from "@/lib/mobile-api/dich-vu/otp-tai-khoan";

export const dynamic = "force-dynamic";

/** POST /api/mobile/v1/auth/activation/confirm — `{dinhDanh, ma, matKhau, maThietBi?}` → `{daDatMatKhau:true}`; mã + mật khẩu CÙNG một yêu cầu. Không cần token (K). */
export async function POST(req: Request) {
  const tat = motMobileTat();
  if (tat) return tat;
  const than = await docThanJson(req, xacNhanSchema);
  if (!than.ok) return than.res;
  try {
    return traThanhCong(await kichHoatTaiKhoan(than.data, nguCanhYeuCau(req)));
  } catch (e) {
    return traLoi(e);
  }
}
