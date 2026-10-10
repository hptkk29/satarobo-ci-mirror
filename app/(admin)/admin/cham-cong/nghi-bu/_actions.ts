"use server";

// Điều chỉnh tay QUỸ NGHỈ BÙ (đợt 8 đơn từ, BA 5.1 nguồn MANUAL_ADJUSTMENT). Quyền
// `hr_attendance:adjust` tại ĐÚNG khối đang xem — cùng quyền với ghi đè công ngày. Lý do bắt buộc,
// quỹ không âm, audit trong cùng giao dịch: `lib/cham-cong/nghi-bu-db.ts`.
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { checkPermission } from "@/lib/auth/check-permission";
import { dieuChinhQuy, nguoiThuocKhoi } from "@/lib/cham-cong/nghi-bu-db";

type Res = { ok: true; soDuSau: number } | { ok: false; error: string };

const schema = z.object({
  userId: z.string().min(1),
  coSo: z.string().min(1),
  phut: z.coerce.number().int(),
  lyDo: z.string().max(500),
});

export async function dieuChinhQuyNghiBuAction(input: unknown): Promise<Res> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: "Chưa đăng nhập" };
  const p = schema.safeParse(input);
  if (!p.success) return { ok: false, error: p.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" };
  const { userId, coSo, phut, lyDo } = p.data;
  if (!(await checkPermission("hr_attendance:adjust", { centerId: coSo }))) {
    return { ok: false, error: "Không có quyền điều chỉnh quỹ nghỉ bù ở cơ sở này" };
  }
  if (!(await nguoiThuocKhoi(userId, coSo, new Date()))) {
    return { ok: false, error: "Người này không thuộc cơ sở đang xem" };
  }
  const r = await dieuChinhQuy({
    userId,
    centerId: coSo,
    phut,
    lyDo,
    actor: { id: session.user.id, name: session.user.name ?? "Quản lý" },
  });
  if (r.ok) revalidatePath("/cham-cong/nghi-bu");
  return r;
}
