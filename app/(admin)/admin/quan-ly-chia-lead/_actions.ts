"use server";
// Server Actions của màn "Quản lý chia lead".
//
// ⚠️ QUYỀN KIỂM Ở ĐÂY, không phải ở UI. Ẩn nút chỉ là chuyện thẩm mỹ — Server Action
// là một endpoint riêng, ai biết tên hàm là gọi được thẳng.
//
// Hai tầng quyền, cố ý khác nhau:
//   · `lead_pool:manage`     — Quản trị + Quản lý cơ sở: bật/tắt/thêm người trong pool;
//   · `leads:assign-config`  — CHỈ Quản trị: đặt lại lượt toàn cơ sở, chỉnh lượt tay.
// Hai việc sau đụng thẳng vào bộ đếm — thứ mà cả module này tồn tại để bảo vệ.
//
// Cách ly cơ sở KHÔNG dựa vào scope của quyền (cả hai đều GLOBAL vì là cổng trang):
// mọi action đều tự kiểm `centerId` có nằm trong tầm nhìn của actor không.

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { checkPermission } from "@/lib/auth/check-permission";
import { resolveActor } from "@/lib/auth/actor";
import {
  themVaoPool,
  tamNghiPool,
  quayLaiPool,
  datLaiLuotDonVi,
  chinhLuotThuCong,
} from "@/lib/lead/assignment-pool";

type KQ = { ok: boolean; error?: string };

const CHUA_DANG_NHAP = "Chưa đăng nhập";

/**
 * Gác chung: đăng nhập → quyền → CƠ SỞ CÓ TRONG TẦM NHÌN.
 *
 * Vế thứ ba là thứ dễ quên nhất: quyền ở đây là GLOBAL (bắt buộc, vì nó gác trang),
 * nên thiếu vế này thì Quản lý cơ sở CS1 gọi thẳng action với `centerId` của CS2 là
 * tắt được người của cơ sở khác.
 */
async function gac(
  centerId: string,
  perm: "lead_pool:manage" | "leads:assign-config",
): Promise<{ ok: true; actorId: string } | { ok: false; error: string }> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: CHUA_DANG_NHAP };
  if (!(await checkPermission(perm))) return { ok: false, error: "Không có quyền" };

  const actor = await resolveActor(session.user.id);
  const trongTam =
    actor.isSuperAdmin || actor.isHoLevel || actor.visibleCenterIds.includes(centerId);
  if (!trongTam) return { ok: false, error: "Cơ sở này không thuộc phạm vi của bạn" };

  return { ok: true, actorId: session.user.id };
}

function xong(): void {
  revalidatePath("/admin/quan-ly-chia-lead");
}

export async function themSaleVaoPoolAction(input: {
  centerId: string;
  userId: string;
}): Promise<KQ> {
  const g = await gac(input.centerId, "lead_pool:manage");
  if (!g.ok) return g;
  const r = await themVaoPool({ ...input, actorId: g.actorId });
  if (r.ok) xong();
  return r;
}

export async function tatNhanLeadAction(input: {
  centerId: string;
  userId: string;
  reason: string;
}): Promise<KQ> {
  const g = await gac(input.centerId, "lead_pool:manage");
  if (!g.ok) return g;
  // Lý do BẮT BUỘC — `tamNghiPool` tự chặn, nhưng chặn sớm để báo lỗi gọn hơn.
  if (!input.reason?.trim()) return { ok: false, error: "Phải ghi lý do khi tắt nhận lead." };
  const r = await tamNghiPool({ ...input, actorId: g.actorId });
  if (r.ok) xong();
  return r;
}

export async function batNhanLeadAction(input: {
  centerId: string;
  userId: string;
}): Promise<KQ> {
  const g = await gac(input.centerId, "lead_pool:manage");
  if (!g.ok) return g;
  const r = await quayLaiPool({ ...input, actorId: g.actorId });
  if (r.ok) xong();
  return r;
}

/** CHỈ Quản trị — đưa mọi người đang bật về MIN hiện tại (không về 0). */
export async function datLaiLuotAction(input: {
  centerId: string;
  reason: string;
}): Promise<KQ> {
  const g = await gac(input.centerId, "leads:assign-config");
  if (!g.ok) return g;
  const r = await datLaiLuotDonVi({ ...input, actorId: g.actorId });
  if (r.ok) xong();
  return { ok: r.ok, error: r.error };
}

/** CHỈ Quản trị — sửa thẳng số lượt của một người, bắt buộc lý do. */
export async function chinhLuotAction(input: {
  centerId: string;
  userId: string;
  turns: number;
  reason: string;
}): Promise<KQ> {
  const g = await gac(input.centerId, "leads:assign-config");
  if (!g.ok) return g;
  const r = await chinhLuotThuCong({ ...input, actorId: g.actorId });
  if (r.ok) xong();
  return r;
}
