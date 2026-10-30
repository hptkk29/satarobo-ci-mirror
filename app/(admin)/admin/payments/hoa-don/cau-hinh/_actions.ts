"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { checkPermission } from "@/lib/auth/check-permission";
import { resolveActor, type Actor } from "@/lib/auth/actor";
import { scopedDb } from "@/lib/db-scope";
import { laHoaDonBat } from "@/lib/finance/hoa-don/feature";
import { coQuyenKeToanTaiCoSo } from "@/lib/finance/hoa-don/quyen";
import { luuCauHinh } from "@/lib/finance/hoa-don/cau-hinh-co-so-db";

// Cấu hình hoá đơn theo cơ sở (PR2). Quyền: DÙNG LẠI `payments:confirm` + phạm vi kế toán của ĐÚNG cơ sở
// (`coQuyenKeToanTaiCoSo`) — không đẻ quyền mới (quyền mới chỉ sống sau khi bấm seed-prod-roles; quãng giữa là
// "không ai sửa được"). Kế toán cơ sở sửa cơ sở mình; HO_ACCOUNTANT sửa cơ sở được giao.

type KetQua<T> = { ok: true; data: T } | { ok: false; error: string };

/**
 * Cổng chung — wrapper cục bộ MỘT cấp, cùng tệp (lint `require-can-in-write-action` không tính wrapper import).
 * cờ → đăng nhập → `payments:confirm` (trần) → cơ sở TRONG tầm nhìn → là KẾ TOÁN của đúng cơ sở đó.
 * Mọi nhánh từ chối vì phạm vi đều nói "Không tìm thấy cơ sở" — không phân biệt "không có" với "không thuộc bạn".
 */
async function congKeToanCoSo(
  centerId: string,
): Promise<{ ok: false; error: string } | { ok: true; actor: Actor; userId: string; userName: string }> {
  if (!(await laHoaDonBat())) return { ok: false, error: "Màn hoá đơn điện tử chưa được bật" };
  const session = await auth();
  if (!session?.user) return { ok: false, error: "Chưa đăng nhập" };
  if (!(await checkPermission("payments:confirm"))) {
    return { ok: false, error: "Không có quyền — cần quyền xác nhận khoản thu (payments:confirm)" };
  }
  const actor = await resolveActor(session.user.id);
  const coSo = await scopedDb(actor).center.findUnique({ where: { id: centerId }, select: { id: true, code: true } });
  if (!coSo || !coSo.code || !coQuyenKeToanTaiCoSo(actor, coSo.id)) {
    return { ok: false, error: "Không tìm thấy cơ sở" };
  }
  return { ok: true, actor, userId: session.user.id, userName: session.user.name ?? session.user.email ?? session.user.id };
}

const NGAY = /^\d{4}-\d{2}-\d{2}$/;
const luuSchema = z.object({
  /** Vắng = tạo mới. */
  id: z.string().min(1).max(64).optional(),
  centerId: z.string().min(1).max(64),
  phapNhanMa: z.string().trim().min(1).max(64),
  kyHieu: z.string().trim().min(1).max(10),
  hieuLucTu: z.string().regex(NGAY),
  hieuLucDen: z.string().regex(NGAY),
  dangBat: z.boolean(),
  ghiChu: z.string().trim().max(300).nullish(),
  /** Bắt buộc khi sửa / tắt (kiểm ở `luuCauHinh`). */
  lyDo: z.string().trim().max(300).nullish(),
});

/** Thêm / sửa một dòng cấu hình hoá đơn của cơ sở. */
export async function luuCauHinhHoaDonAction(input: unknown): Promise<KetQua<{ id: string }>> {
  const p = luuSchema.safeParse(input);
  if (!p.success) return { ok: false, error: "Yêu cầu không hợp lệ" };
  const v = p.data;
  const cong = await congKeToanCoSo(v.centerId);
  if (!cong.ok) return cong;
  const kq = await luuCauHinh({
    nguoi: { id: cong.userId, name: cong.userName },
    id: v.id,
    du: {
      centerId: v.centerId,
      phapNhanMa: v.phapNhanMa,
      kyHieu: v.kyHieu,
      hieuLucTu: v.hieuLucTu,
      hieuLucDen: v.hieuLucDen,
      dangBat: v.dangBat,
    },
    ghiChu: v.ghiChu ?? null,
    lyDo: v.lyDo ?? null,
  });
  if (!kq.ok) return kq;
  revalidatePath("/payments/hoa-don");
  revalidatePath("/payments/hoa-don/cau-hinh");
  return { ok: true, data: { id: kq.id } };
}
