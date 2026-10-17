"use server";

// Bút toán tay SỔ PHÉP NĂM (P2.1A): cấp quỹ đầu kỳ / điều chỉnh. Quyền `hr_attendance:adjust` tại ĐÚNG
// khối đang xem — cùng quyền với điều chỉnh quỹ nghỉ bù. Lý do bắt buộc, cổng âm theo chính sách
// `shift.soPhepChoAm`, audit trong cùng giao dịch: `lib/cham-cong/so-phep-db.ts`.
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { checkPermission } from "@/lib/auth/check-permission";
import { nguoiThuocKhoi } from "@/lib/cham-cong/nghi-bu-db";
import { docCauHinhSoPhep } from "@/lib/cham-cong/so-phep";
import { dieuChinhSoPhep, loaiNghiSoPhep } from "@/lib/cham-cong/so-phep-db";

type Res = { ok: true; soDuSau: number } | { ok: false; error: string };

const schema = z.object({
  userId: z.string().min(1),
  coSo: z.string().min(1),
  nam: z.coerce.number().int().min(2020).max(2100),
  loai: z.enum(["OPENING", "MANUAL_ADJUSTMENT"]),
  phut: z.coerce.number().int(),
  lyDo: z.string().max(500),
});

export async function dieuChinhSoPhepAction(input: unknown): Promise<Res> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: "Chưa đăng nhập" };
  const p = schema.safeParse(input);
  if (!p.success) return { ok: false, error: p.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" };
  const { userId, coSo, nam, loai, phut, lyDo } = p.data;
  if (!(await checkPermission("hr_attendance:adjust", { centerId: coSo }))) {
    return { ok: false, error: "Không có quyền điều chỉnh sổ phép ở cơ sở này" };
  }
  if (!(await nguoiThuocKhoi(userId, coSo, new Date()))) {
    return { ok: false, error: "Người này không thuộc cơ sở đang xem" };
  }
  const cauHinh = await docCauHinhSoPhep();
  const lt = await loaiNghiSoPhep(cauHinh.maLoai);
  if (!lt) return { ok: false, error: `Chưa có loại nghỉ mã ${cauHinh.maLoai} — kiểm tham số “Mã loại nghỉ trừ sổ phép”` };
  const r = await dieuChinhSoPhep({
    userId,
    centerId: coSo,
    leaveTypeId: lt.id,
    year: nam,
    loai,
    phut,
    lyDo,
    choAm: cauHinh.choAm,
    ngayHieuLuc: new Date(Date.UTC(nam, 0, 1)),
    actor: { id: session.user.id, name: session.user.name ?? "Quản lý" },
  });
  if (r.ok) revalidatePath("/cham-cong/so-phep");
  return r;
}
