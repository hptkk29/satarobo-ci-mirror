import type { Actor } from "@/lib/auth/actor";

// REQ-04/05 — Khoá cache theo scope actor. BẮT BUỘC gồm visibleCenterIds (đã sort) để
// cache aggregate dashboard/report KHÔNG leak giữa cơ sở: CENTER_MANAGER CS1 và
// SUPER_ADMIN (thấy tất cả) sinh key KHÁC nhau → không bao giờ đọc nhầm số của nhau.
// isSuperAdmin phân biệt "thấy toàn hệ thống" khỏi "thấy đúng danh sách center này".
//
// ⚠️ MỌI cache số liệu aggregate PHẢI đưa key này vào keyParts của unstable_cache.
export function actorScopeKey(
  actor: Pick<Actor, "visibleCenterIds" | "isSuperAdmin">,
): string {
  const centers = [...actor.visibleCenterIds].sort().join(",");
  return `${actor.isSuperAdmin ? "super" : "scoped"}:${centers}`;
}
