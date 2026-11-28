import { type NextRequest } from "next/server";
import { requireLiveSession } from "@/lib/auth/live-session";
import { resolveActor } from "@/lib/auth/actor";
import { can } from "@/lib/auth/can";
import { fail } from "@/lib/api/response";
import { chanApiKhiTat } from "@/lib/elearning/api-gate";
import { MAU_THEO_LOAI } from "@/lib/elearning-online/nhap-cau-hoi";
import { taoTepMau } from "@/lib/elearning-online/nhap-cau-hoi-tep";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * QoImport — tải BỘ MẪU nhập câu hỏi (.xlsx, mỗi dạng một sheet + HUONG-DAN). Không đọc/ghi DB.
 * Gác: cờ → phiên SỐNG → `onl:assessment:manage` (cùng quyền với việc soạn câu hỏi).
 */
export async function GET(req: NextRequest) {
  const chanCo = chanApiKhiTat();
  if (chanCo) return chanCo;
  const session = await requireLiveSession();
  if (!session?.user?.id) return fail("UNAUTHENTICATED", "Chưa đăng nhập", { status: 401 });
  const actor = await resolveActor(session.user.id);
  if (!can(actor, "onl:assessment:manage")) return fail("PERMISSION_DENIED", "Không có quyền soạn câu hỏi online", { status: 403 });
  // `?dang=<mã dạng>` ⇒ mẫu RIÊNG một dạng (tên tệp theo `MauLoai.tepMau`); mã lạ ⇒ 400 (không âm thầm trả bộ đầy đủ).
  const dang = req.nextUrl.searchParams.get("dang");
  const mau = dang ? MAU_THEO_LOAI.find((m) => m.loai === dang) : undefined;
  if (dang && !mau) return fail("VALIDATION_ERROR", "Dạng câu không hợp lệ", { status: 400 });
  const buf = taoTepMau(mau?.loai);
  return new Response(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${mau ? mau.tepMau : "mau-nhap-cau-hoi-online.xlsx"}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
