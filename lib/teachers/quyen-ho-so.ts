// lib/teachers/quyen-ho-so.ts — "người xem MỞ ĐƯỢC hồ sơ giáo viên này không" ở MỘT chỗ (24/10/2026).
// Trước đây điều kiện viết tay trong `app/(admin)/admin/teachers/[id]/page.tsx`; màn Rank giáo viên cần CÙNG câu hỏi để chỉ vẽ link
// hồ sơ cho người mở được (luật 12 — link dẫn tới trang đá về dashboard là lời hứa suông). Hai nơi chép tay là hai luật lệch nhau.
// Luật (giữ nguyên bản gốc): chính mình · hoặc `employees:view-all` tại cơ sở của GV, và Quản lý cơ sở chỉ ở CHÍNH cơ sở mình.
import "server-only";
import { hasRole } from "@/lib/auth/permissions";
import { checkPermission } from "@/lib/auth/check-permission";

export type NguoiXem = { id: string; role?: string | null; roles?: string[] | null; centerId?: string | null };

/** Quyết định thuần khi đã biết `xemTatCa` (= `employees:view-all` tại cơ sở GV). Tách ra để test không cần phiên. */
export function luatMoHoSo(me: NguoiXem, gv: { id: string; centerId: string | null }, xemTatCa: boolean): boolean {
  if (me.id === gv.id) return true;
  if (!xemTatCa) return false;
  return !hasRole(me, "CENTER_MANAGER") || gv.centerId === (me.centerId ?? null);
}

export async function moDuocHoSoGv(me: NguoiXem, gv: { id: string; centerId: string | null }): Promise<boolean> {
  if (me.id === gv.id) return true;
  return luatMoHoSo(me, gv, await checkPermission("employees:view-all", { centerId: gv.centerId }));
}

/** Theo lô: hỏi quyền MỘT lần mỗi cơ sở (không mỗi GV). Trả tập userId mở được. */
export async function hoSoMoDuoc(me: NguoiXem, gvs: readonly { id: string; centerId: string | null }[]): Promise<Set<string>> {
  const coSo = [...new Set(gvs.map((g) => g.centerId))];
  const quyen = new Map(await Promise.all(coSo.map(async (c) => [c, await checkPermission("employees:view-all", { centerId: c })] as const)));
  return new Set(gvs.filter((g) => luatMoHoSo(me, g, quyen.get(g.centerId) ?? false)).map((g) => g.id));
}
