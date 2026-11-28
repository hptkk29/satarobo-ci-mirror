import { docThanJson, motMobileTat, nguCanhYeuCau, traLoi, traThanhCong } from "@/lib/mobile-api/cong";
import { dangNhapSchema } from "@/lib/mobile-api/schema/auth";
import { dangNhap } from "@/lib/mobile-api/xac-thuc/dich-vu";

export const dynamic = "force-dynamic";

/** POST /api/mobile/v1/auth/login — `{dinhDanh, matKhau, thietBi}` → `{accessToken, refreshToken, hetHanSau}`. Không cần token (K). */
export async function POST(req: Request) {
  const tat = motMobileTat();
  if (tat) return tat;
  const than = await docThanJson(req, dangNhapSchema);
  if (!than.ok) return than.res;
  try {
    return traThanhCong(await dangNhap(than.data, nguCanhYeuCau(req)));
  } catch (e) {
    return traLoi(e);
  }
}
