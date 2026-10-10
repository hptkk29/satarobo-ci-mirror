// lib/auth/menu-permissions.ts — tập action dùng để LỌC MENU, tính phía server.
//
// Vì sao tồn tại: `components/admin/sidebar.tsx` trước 10/07 lọc menu bằng `can(user, p)`
// — ma trận v1 TĨNH, luôn luôn. Còn `page.tsx` gác bằng `checkPermission()` — THEO CỜ
// `RBAC_V2_ENABLED`. Cờ OFF thì hai bên trùng nhau nên không ai thấy gì. Cờ ON thì chúng
// tách đôi ở mọi vai có v2 ≠ v1:
//   · CENTER_MANAGER mất 9 nhóm quyền ở v2 ⇒ menu v1 vẫn mời vào ⇒ 9 dead link.
//   · HO_MARKETING được `honors:settings` ở v2 ⇒ menu v1 vẫn giấu ⇒ trang mở mà không lối vào.
// Tức là bật cờ sẽ TỰ SINH lại đúng lớp lỗi mà `page-gates.ts` vừa diệt.
//
// Cách sửa: layout (server) hỏi CÙNG hàm quyết định mà cổng trang dùng
// (`evaluatePermission` + cờ), trả xuống sidebar một tập action đã chốt.
//
// Menu KHÔNG ghi shadow-diff và KHÔNG dùng logger mặc định của `decidePermission`
// (mặc định là `console`, sẽ warn ~120 lần/request). Menu không phải điểm cưỡng chế;
// ghi shadow ở đây sẽ bơm ~120 dòng RbacShadowDiff mỗi lần mở trang, dìm chết tín hiệu thật.
import { PERMISSIONS, can as canMatrix, type Action } from "@/lib/auth/permissions";
import type { Actor } from "@/lib/auth/actor";
import { resolveGrant } from "@/lib/permissions/can";

type MenuUser = Parameters<typeof canMatrix>[0];

/**
 * v2: user có GIỮ action này không (ở BẤT KỲ scope nào)?
 *
 * ⚠️ Câu hỏi này KHÁC câu hỏi của cổng trang. Cổng hỏi "với target cụ thể này thì được
 * không"; menu không có target nào để hỏi — nó chỉ quyết định có vẽ lối vào hay không.
 *
 * Trước đây hàm này gọi `evaluatePermission` trần (không target). `can.ts:scopeMatches`
 * trả **false** cho scope CENTER/CLASS/OWN/ASSIGNED khi thiếu target ⇒ ngay lúc flip,
 * mọi mục menu gác bằng action scope-cơ-sở sẽ BIẾN MẤT dù trang vẫn cho vào:
 *   · Giáo vụ / Trợ giảng giữ `attendance:view[CENTER|ASSIGNED]` → mất "Điểm danh"
 *   · QL cơ sở + Nhân sự cơ sở giữ `hr_attendance:view[CENTER]`  → mất "Chấm công"
 * Tức là chính lớp lỗi "ẩn oan" mà `page-gates.ts` sinh ra để diệt. Bắt được nhờ phản
 * biện SRE trước khi viết runbook rollback, 10/07.
 *
 * Vẫn an toàn: cách ly cơ sở nằm ở `scopedDb` + target ở cổng, KHÔNG ở việc giấu menu.
 * Còn action dùng làm **gate trần** (mọi action trong `PAGE_GATES`) bắt buộc `GLOBAL`
 * — `rbac-scope.test.ts` ép — nên với chúng "có giữ" ≡ "dùng được ngay": menu và cổng
 * vẫn nói đúng một câu chuyện ở mọi route trong bảng.
 */
function v2HoldsAction(actor: Actor | null, action: string): boolean {
  if (!actor) return false;
  if (actor.isSuperAdmin) return true;
  if (actor.grantsAllow.has(action)) return true;
  return actor.permissions.some((p) => p.action === action);
}

/**
 * Mọi action user được phép, theo ĐÚNG hệ quyền mà cổng trang đang dùng (v1 hay v2 tuỳ cờ).
 *
 * Đánh giá toàn bộ `PERMISSIONS` (~120 action) chứ không chỉ action có trong menu: rẻ
 * (thuần in-memory, không I/O) và tránh phải kéo cây menu vào server. Không rò rỉ gì —
 * trước đây client đã nhận cả ma trận v1 qua `can()` trong bundle sidebar.
 */
export function grantedMenuActions(params: {
  sessionUser: MenuUser;
  actor: Actor | null;
  flagOn: boolean;
}): string[] {
  const out: string[] = [];
  for (const action of Object.keys(PERMISSIONS) as Action[]) {
    // US-03: bảng PermissionGrant MỚI cắm TRƯỚC đường cũ ở cổng trang
    // (`decidePermissionWithGrant` — BẤT KỂ cờ), nên menu phải hỏi cùng câu,
    // ĐỐI XỨNG cả hai chiều (vá review 09/08 — trước đây chỉ TRỪ, không CỘNG):
    //   · grant DENY toàn-action khớp (hit && !allowed) ⇒ cổng sẽ chặn ⇒ vẽ lối
    //     vào là tái sinh dead-link → ẨN.
    //   · grant ALLOW khớp target-trần (hit && allowed) ⇒ cổng MỞ trang dù
    //     v1/v2 nói không ⇒ giấu menu là "ẩn oan" — đúng lớp lỗi page-gates.ts
    //     sinh ra để diệt → VẪN VẼ.
    // resolveGrant PURE/SYNC trên actor đã nạp — 0 query. Menu không có target:
    // grant dataScope ALL khớp luôn; scope hẹp (UNIT_*/OWN) không khớp
    // target-trần → không đổi quyết định (đúng triết lý "có giữ action" ở trên).
    const d = params.actor ? resolveGrant(params.actor, action) : null;
    if (d?.hit) {
      // Grant đã nói về action này thì grant là nguồn sự thật — không hỏi v1/v2.
      if (d.allowed) out.push(action);
      continue;
    }
    const ok = params.flagOn
      ? v2HoldsAction(params.actor, action)
      : canMatrix(params.sessionUser, action);
    if (ok) out.push(action);
  }
  return out;
}
