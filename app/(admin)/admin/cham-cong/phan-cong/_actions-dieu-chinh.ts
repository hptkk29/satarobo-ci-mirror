"use server";

// Điều chỉnh tiền + đối soát tháng Parttime (SR.QD.238 · P5c/P5d). Hai quyền KHÁC NHAU:
//   · `danhDauCuAction` — ghi STALE cho đơn vị (dạy + trực) đã lệch sau khi xác nhận: `hr_attendance:assign`.
//   · `dongBoDeXuatAction` — dựng / rút ĐỀ XUẤT từ bằng chứng: `hr_attendance:assign` (người phân công cơ sở).
//   · `quyetDieuChinhAction` — xác nhận / không áp / huỷ một khoản trừ lương: `hr_attendance:approve` (seed: chỉ QLCS cơ sở) ở cơ sở
//     của khoản đó TRA TỪ DB. Không ai tự quyết khoản của chính mình (dịch vụ chặn).
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { checkPermission } from "@/lib/auth/check-permission";
import { dongBoDeXuat, quyetDieuChinh } from "@/lib/parttime/dieu-chinh-db";
import { phanCongBat } from "@/lib/parttime/phan-cong-db";
import { coSoCuaDieuChinh } from "@/lib/parttime/thao-tac";
import { danhDauTrucCu } from "@/lib/parttime/truc-van-hanh-db";
import { danhDauDonViCu } from "@/lib/parttime/workunit-db";

type Res = { ok: true; message?: string } | { ok: false; error: string };
const BASE = "/cham-cong/phan-cong";

async function congDieuChinh(quyen: "hr_attendance:assign" | "hr_attendance:approve", centerId: string | null): Promise<{ ok: true; actor: { id: string; name: string } } | { ok: false; error: string }> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: "Phiên đăng nhập đã hết — đăng nhập lại." };
  if (!centerId) return { ok: false, error: "Không tìm thấy khoản / cơ sở." };
  if (!(await checkPermission(quyen, { centerId }))) return { ok: false, error: "Bạn không có quyền với điều chỉnh tiền ở cơ sở này." };
  if (!(await phanCongBat())) return { ok: false, error: "Phân công theo buổi chưa bật." };
  return { ok: true, actor: { id: session.user.id, name: session.user.name ?? session.user.email ?? "Quản lý" } };
}

const NGAY = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export async function dongBoDeXuatAction(input: unknown): Promise<Res> {
  const p = z.object({ centerId: z.string().min(1), tu: NGAY, den: NGAY }).safeParse(input);
  if (!p.success) return { ok: false, error: "Dữ liệu không hợp lệ" };
  const g = await congDieuChinh("hr_attendance:assign", p.data.centerId);
  if (!g.ok) return g;
  try {
    const r = await dongBoDeXuat({ ...p.data, now: new Date(), actor: g.actor });
    revalidatePath(BASE);
    return { ok: true, message: `Đề xuất mới ${r.tao} · rút ${r.rut}.` };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Không thực hiện được — thử lại." };
  }
}

export async function quyetDieuChinhAction(input: unknown): Promise<Res> {
  const p = z.object({ id: z.string().min(1), quyet: z.enum(["CONFIRMED", "REJECTED", "CANCELLED"]), lyDo: z.string().trim().max(500).optional() }).safeParse(input);
  if (!p.success) return { ok: false, error: "Dữ liệu không hợp lệ" };
  const g = await congDieuChinh("hr_attendance:approve", await coSoCuaDieuChinh(p.data.id));
  if (!g.ok) return g;
  try {
    const r = await quyetDieuChinh({ ...p.data, lyDo: p.data.lyDo ?? null, actor: g.actor, now: new Date() });
    if (!r.ok) return { ok: false, error: r.loi };
    revalidatePath(BASE);
    return { ok: true, message: "Đã ghi quyết định." };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Không thực hiện được — thử lại." };
  }
}

/** Ghi STALE (trạng thái LƯU) cho mọi đơn vị dạy + trực đã lệch trong khoảng — để nơi nào đọc cột `status` cũng không trả tiền
 *  cho sự thật đã đổi. Khoản trừ đang đề xuất của đơn vị đó bị rút cùng giao dịch. */
export async function danhDauCuAction(input: unknown): Promise<Res> {
  const p = z.object({ centerId: z.string().min(1), tu: NGAY, den: NGAY }).safeParse(input);
  if (!p.success) return { ok: false, error: "Dữ liệu không hợp lệ" };
  const g = await congDieuChinh("hr_attendance:assign", p.data.centerId);
  if (!g.ok) return g;
  try {
    const now = new Date();
    const day = await danhDauDonViCu({ ...p.data, now, actor: g.actor });
    const truc = await danhDauTrucCu({ ...p.data, now, actor: g.actor });
    revalidatePath(BASE);
    return { ok: true, message: day + truc ? `Đã đánh dấu ${day + truc} đơn vị cần xác nhận lại.` : "Không có đơn vị nào lệch." };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Không thực hiện được — thử lại." };
  }
}
