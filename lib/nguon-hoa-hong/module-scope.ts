// lib/nguon-hoa-hong/module-scope.ts — NGUỒN QUYỀN DUY NHẤT của khung module "Nguồn lead & Chính sách hoa
// hồng". Quyền hỏi MỘT lần cho cả request; page, ModuleNav và ScopeBar đọc chung kết quả (docs/source-commission
// 06 §4.3, 05 §1.5). Lõi thuần nằm ở `scope.ts` (test không cần DB/session).
//
// ⚠️ KHÔNG chép nguyên khuôn `lib/cham-cong/module-scope.ts` (hỏi `can(action, { centerId })` từng khối): khuôn đó
// chỉ đúng vì quyền chấm công seed `CENTER`. Key ở đây seed `GLOBAL` nên `can()` trả `true` cho mọi cơ sở. Ở đây
// `has(action)` trả lời "CÓ quyền không", còn "THẤY cơ sở nào" lấy từ `getModelVisibleCenterIds` theo model của tab
// (ca `[NHH-FE-09]`).
//
// Quyền đi qua CÙNG lõi quyết định với `checkPermission` (`decidePermissionWithGrant`: grant per-user → v1/v2/cờ
// RBAC_V2) nhưng gọi `auth()` + `resolveActor()` MỘT lần thay vì mười lần — `resolveActor` đã React.cache.
// Session không khớp `userId` ⇒ KHÔNG quyền nào (fail-closed), không rơi về quyền của người khác.
//
// KHÔNG 'use server': module server thường (page gọi trực tiếp). File 'use server' thì MỌI export biến thành
// endpoint POST.
import { auth } from "@/lib/auth";
import { resolveActor } from "@/lib/auth/actor";
import { decidePermissionWithGrant } from "@/lib/auth/permission-decision";
import { getModelVisibleCenterIds, scopedDb } from "@/lib/db-scope";
import { laEngineHoaHongBat } from "@/lib/hoa-hong/feature";
import { laQuanLyNguonBat } from "@/lib/nguon/feature";
import {
  MODULE_KEYS,
  dungNguonHoaHongScope,
  type ModuleKey,
  type NguonHoaHongScope,
} from "./scope";

/** Hai cờ của module. Đọc hỏng ⇒ TẮT (một mục thiếu tốt hơn cả khung sập; cùng nếp layout). */
export async function docCoModule(): Promise<{ nguon: boolean; engine: boolean }> {
  const [nguon, engine] = await Promise.all([
    laQuanLyNguonBat().catch(() => false),
    laEngineHoaHongBat().catch(() => false),
  ]);
  return { nguon, engine };
}

export async function loadNguonHoaHongScope(userId: string): Promise<NguonHoaHongScope> {
  const [session, actor, co] = await Promise.all([auth(), resolveActor(userId), docCoModule()]);

  const quyen = new Set<ModuleKey>();
  const user = session?.user;
  if (user && user.id === userId) {
    for (const key of MODULE_KEYS) {
      // `key` là BIẾN trong vòng lặp, không phải literal trần — và key ở đây seed GLOBAL nên không cần target.
      if (decidePermissionWithGrant({ sessionUser: user, actor, action: key })) quyen.add(key);
    }
  }

  const sdb = scopedDb(actor);
  const cacCoSo = await sdb.center.findMany({
    where: { isActive: true, code: { not: null } },
    select: { id: true, code: true, name: true },
    orderBy: { displayOrder: "asc" },
  });

  return dungNguonHoaHongScope({
    quyen,
    co,
    centerIds: {
      Lead: getModelVisibleCenterIds("Lead", actor),
      CommissionPeriod: getModelVisibleCenterIds("CommissionPeriod", actor),
      CommissionTransaction: getModelVisibleCenterIds("CommissionTransaction", actor),
    },
    cacCoSo,
  });
}
