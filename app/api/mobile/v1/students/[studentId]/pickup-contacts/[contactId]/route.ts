import { chayTheoHocVien, chayTheoHocVienCoThan, traThanhCong } from "@/lib/mobile-api/cong";
import { goNguoiDon, suaNguoiDon, suaNguoiDonSchema } from "@/lib/mobile-api/dich-vu/ho-so-ghi";

export const dynamic = "force-dynamic";

/** PATCH /api/mobile/v1/students/:studentId/pickup-contacts/:contactId — sửa người đón (chỉ dòng ĐANG hiệu lực của chính bé này; khác ⇒ 404). Có AUDIT. */
export async function PATCH(req: Request, ctx: { params: Promise<{ studentId: string; contactId: string }> }) {
  const { studentId, contactId } = await ctx.params;
  return chayTheoHocVienCoThan(req, studentId, suaNguoiDonSchema, async (hs, nguoi, _ctx, thanDl) => traThanhCong(await suaNguoiDon(hs, nguoi, contactId, thanDl)));
}

/** DELETE — GỠ quyền đón = thu hồi (giữ dòng để truy vết). Gỡ lần hai / dòng của bé khác ⇒ 404. Có AUDIT. */
export async function DELETE(req: Request, ctx: { params: Promise<{ studentId: string; contactId: string }> }) {
  const { studentId, contactId } = await ctx.params;
  return chayTheoHocVien(req, studentId, async (hs, nguoi) => traThanhCong(await goNguoiDon(hs, nguoi, contactId)));
}
