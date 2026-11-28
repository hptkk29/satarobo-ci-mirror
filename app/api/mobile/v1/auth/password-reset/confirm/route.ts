import { docThanJson, motMobileTat, nguCanhYeuCau, traLoi, traThanhCong } from "@/lib/mobile-api/cong";
import { datLaiMatKhau, xacNhanSchema } from "@/lib/mobile-api/dich-vu/otp-tai-khoan";

export const dynamic = "force-dynamic";

/** POST /api/mobile/v1/auth/password-reset/confirm — `{dinhDanh, ma, matKhau, maThietBi?}` → `{daDatMatKhau:true}`; thu hồi MỌI phiên di động + web. Không cần token (K). */
export async function POST(req: Request) {
  const tat = motMobileTat();
  if (tat) return tat;
  const than = await docThanJson(req, xacNhanSchema);
  if (!than.ok) return than.res;
  try {
    return traThanhCong(await datLaiMatKhau(than.data, nguCanhYeuCau(req)));
  } catch (e) {
    return traLoi(e);
  }
}
