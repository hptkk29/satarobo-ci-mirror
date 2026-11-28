import { chayTheoHocVien, chayTheoHocVienCoThan, traThanhCong } from "@/lib/mobile-api/cong";
import { guiDoiQua, guiDoiQuaSchema, layYeuCauDoiQua } from "@/lib/mobile-api/dich-vu/doi-qua";

export const dynamic = "force-dynamic";

/** GET /api/mobile/v1/students/:studentId/gift-redemptions — các yêu cầu đổi quà của bé (kèm trạng thái «trung tâm duyệt»). Cờ SataCoin TẮT ⇒ 404. Cổng C. */
export async function GET(req: Request, ctx: { params: Promise<{ studentId: string }> }) {
  const { studentId } = await ctx.params;
  return chayTheoHocVien(req, studentId, async (hs) => traThanhCong(await layYeuCauDoiQua(hs)));
}

/** POST /api/mobile/v1/students/:studentId/gift-redemptions — gửi MỘT yêu cầu đổi quà ⇒ GIỮ coin + giữ chỗ quà; trung tâm duyệt sau. Gửi lại cùng `idempotencyKey` ⇒ bản cũ. Cổng C. */
export async function POST(req: Request, ctx: { params: Promise<{ studentId: string }> }) {
  const { studentId } = await ctx.params;
  return chayTheoHocVienCoThan(req, studentId, guiDoiQuaSchema, async (hs, nguoi, _ctx, thanDl) => traThanhCong(await guiDoiQua(hs, nguoi.userId, thanDl)));
}
