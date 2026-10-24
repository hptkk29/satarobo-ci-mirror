"use server";

// Trực vận hành TƯỜNG MINH (SR.QD.238 · P5b, D-Q3). QLCS giao / huỷ trực và xác nhận đơn vị trả của ca trực.
// Mỗi action: auth → `hr_attendance:assign` Ở ĐÚNG CƠ SỞ (giao: cơ sở trên form, chỉ giao được nơi mình có quyền;
// huỷ / xác nhận: cơ sở của dòng trực TRA TỪ DB) → công tắc → dịch vụ `lib/parttime/truc-van-hanh-db.ts`.
// Không có action "nhận trực thay": nhận / từ chối là việc của chính người được giao (site giáo viên).
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { checkPermission } from "@/lib/auth/check-permission";
import { congThaoTacParttime } from "@/lib/parttime/cong-tac";
import { coSoCuaTruc, trongGiaoDich } from "@/lib/parttime/thao-tac";
import { giaoTruc, huyTruc, xacNhanTruc } from "@/lib/parttime/truc-van-hanh-db";

type Res = { ok: true; message?: string } | { ok: false; error: string };
const ASSIGN = "hr_attendance:assign";
const BASE = "/cham-cong/phan-cong";
const CHUA_BAT = {
  STAFFING: "Phân công theo buổi chưa bật ở cơ sở này. Quản trị bật ở Cấu hình vận hành → Chấm công.",
  WORKUNIT_SHADOW: "Đối soát Parttime chưa bật ở cơ sở này — chưa xác nhận được ca trực.",
} as const;

/** Giao / huỷ trực = STAFFING; xác nhận đơn vị trả của ca trực = WORKUNIT_SHADOW. `loai` BẮT BUỘC. */
async function congTruc(centerId: string | null, loai: keyof typeof CHUA_BAT): Promise<{ ok: true; actor: { id: string; name: string } } | { ok: false; error: string }> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: "Phiên đăng nhập đã hết — đăng nhập lại." };
  if (!centerId) return { ok: false, error: "Không tìm thấy dòng trực / cơ sở." };
  if (!(await checkPermission(ASSIGN, { centerId }))) return { ok: false, error: "Bạn không có quyền giao trực ở cơ sở này." };
  const ct = await congThaoTacParttime(loai, { centerId }, CHUA_BAT[loai]);
  if (!ct.ok) return { ok: false, error: ct.error };
  return { ok: true, actor: { id: session.user.id, name: session.user.name ?? session.user.email ?? "Quản lý" } };
}

const loiCua = (e: unknown) => (e instanceof Error ? e.message : "Không thực hiện được — thử lại.");

export async function giaoTrucAction(input: unknown): Promise<Res> {
  const p = z
    .object({ userId: z.string().min(1), centerId: z.string().min(1), ngay: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), shiftCode: z.string().min(1).max(10), note: z.string().trim().max(300).optional() })
    .safeParse(input);
  if (!p.success) return { ok: false, error: p.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" };
  const g = await congTruc(p.data.centerId, "STAFFING");
  if (!g.ok) return g;
  try {
    const r = await trongGiaoDich((tx) => giaoTruc(tx, { ...p.data, note: p.data.note || null, actor: g.actor }));
    if (!r.ok) return { ok: false, error: r.loi };
    revalidatePath(BASE);
    return { ok: true, message: "Đã giao trực — chờ người được giao xác nhận." };
  } catch (e) {
    return { ok: false, error: loiCua(e) };
  }
}

export async function huyTrucAction(input: unknown): Promise<Res> {
  const p = z.object({ dutyId: z.string().min(1), lyDo: z.string().trim().min(5, "Ghi lý do (tối thiểu 5 ký tự)").max(500) }).safeParse(input);
  if (!p.success) return { ok: false, error: p.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" };
  const g = await congTruc(await coSoCuaTruc(p.data.dutyId), "STAFFING");
  if (!g.ok) return g;
  try {
    const r = await trongGiaoDich((tx) => huyTruc(tx, { ...p.data, actor: g.actor }));
    if (!r.ok) return { ok: false, error: r.loi };
    revalidatePath(BASE);
    return { ok: true, message: "Đã huỷ trực." };
  } catch (e) {
    return { ok: false, error: loiCua(e) };
  }
}

export async function xacNhanTrucAction(input: unknown): Promise<Res> {
  const p = z
    .object({
      dutyId: z.string().min(1),
      phienBanDaXem: z.number().int().min(1),
      dauVanDaXem: z.string().min(1),
      quyetDinh: z.enum(["CONFIRMED", "REJECTED", "NEEDS_INFO"]),
      lyDo: z.string().trim().max(500).optional(),
    })
    .safeParse(input);
  if (!p.success) return { ok: false, error: p.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" };
  const g = await congTruc(await coSoCuaTruc(p.data.dutyId), "WORKUNIT_SHADOW");
  if (!g.ok) return g;
  try {
    const r = await xacNhanTruc({ ...p.data, lyDo: p.data.lyDo ?? null, hangLoat: false, actor: g.actor, now: new Date() });
    if (!r.ok) return { ok: false, error: r.loi };
    revalidatePath(BASE);
    return { ok: true, message: r.daCo ? "Đã xác nhận từ trước." : "Đã ghi quyết định." };
  } catch (e) {
    return { ok: false, error: loiCua(e) };
  }
}
