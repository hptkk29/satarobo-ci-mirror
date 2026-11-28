import { docThanJson, motMobileTat, nguCanhYeuCau, traLoi, traThanhCong } from "@/lib/mobile-api/cong";
import { lamMoiSchema } from "@/lib/mobile-api/schema/auth";
import { lamMoi } from "@/lib/mobile-api/xac-thuc/dich-vu";

export const dynamic = "force-dynamic";

/** POST /api/mobile/v1/auth/refresh — `{refreshToken}` → cặp token mới (xoay vòng, phát hiện dùng lại). Không cần access token (K). */
export async function POST(req: Request) {
  const tat = motMobileTat();
  if (tat) return tat;
  const than = await docThanJson(req, lamMoiSchema);
  if (!than.ok) return than.res;
  try {
    return traThanhCong(await lamMoi(than.data.refreshToken, nguCanhYeuCau(req)));
  } catch (e) {
    return traLoi(e);
  }
}
