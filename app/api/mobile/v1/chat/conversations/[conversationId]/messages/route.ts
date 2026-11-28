import { fail } from "@/lib/api/response";
import { chayDaDangNhap, chayDaDangNhapCoThan, traThanhCong } from "@/lib/mobile-api/cong";
import { guiTin, guiTinSchema, layTinNhan, locTinSchema } from "@/lib/mobile-api/dich-vu/chat";

export const dynamic = "force-dynamic";

/** GET /api/mobile/v1/chat/conversations/:id/messages[?truoc=&soLuong=] — tin nhắn (MỚI → CŨ), cuộn lên bằng con trỏ `truoc` (= `conTro` trang trước). Không phải thành viên ⇒ 404. */
export async function GET(req: Request, ctx: { params: Promise<{ conversationId: string }> }) {
  const { conversationId } = await ctx.params;
  const loc = locTinSchema.safeParse(Object.fromEntries(new URL(req.url).searchParams));
  return chayDaDangNhap(req, async (nguoi) => {
    if (!loc.success) {
      const dau = loc.error.issues[0];
      return fail("VALIDATION", dau?.message || "Tham số không hợp lệ.", { status: 400, field: dau?.path.join(".") || undefined, headers: { "Cache-Control": "no-store" } });
    }
    return traThanhCong(await layTinNhan(nguoi, conversationId, loc.data));
  });
}

/**
 * POST { noiDung, khoaGuiLai: UUID, traLoiId?: UUID } — gửi tin CHỮ. Idempotent theo `khoaGuiLai` (gửi lại ⇒ cùng tin, `trungLap:true`). Giới hạn 20 tin/phút (web). Hội thoại đã lưu trữ/khoá ⇒ 409 `CHAT_KHONG_GUI_DUOC`.
 * Tệp đính kèm CHƯA hỗ trợ (strict: trường lạ ⇒ 400) — cần R2 private (B-CHAT-ATTACH).
 */
export async function POST(req: Request, ctx: { params: Promise<{ conversationId: string }> }) {
  const { conversationId } = await ctx.params;
  return chayDaDangNhapCoThan(req, guiTinSchema, async (nguoi, _ctx, thanDl) => traThanhCong(await guiTin(nguoi, conversationId, thanDl)));
}
