import { docThanJson, motMobileTat, nguCanhYeuCau, traLoi, traThanhCong } from "@/lib/mobile-api/cong";
import { xinMaDatLai, xinMaSchema } from "@/lib/mobile-api/dich-vu/otp-tai-khoan";

export const dynamic = "force-dynamic";

/** POST /api/mobile/v1/auth/password-reset/request-otp — `{dinhDanh, maThietBi?}` → `{choGuiLaiSau}`; LUÔN cùng hình dạng dù tài khoản có/không. Không cần token (K). */
export async function POST(req: Request) {
  const tat = motMobileTat();
  if (tat) return tat;
  const than = await docThanJson(req, xinMaSchema);
  if (!than.ok) return than.res;
  try {
    return traThanhCong(await xinMaDatLai(than.data, nguCanhYeuCau(req)));
  } catch (e) {
    return traLoi(e);
  }
}
