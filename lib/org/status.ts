// lib/org/status.ts — Nền Hệ thống P1 · US-05: ĐÚNG MỘT định nghĩa "đơn vị còn sống".
//
// VÌ SAO CÓ FILE NÀY. OrgUnit sau P1 mang BA cờ sống/chết: `deletedAt` (xoá mềm),
// `isActive` (bật/tắt, có từ A0-01), và `status` (ACTIVE|SUSPENDED|CLOSED của BA §2.2),
// cộng khoảng hiệu lực `effectiveFrom/To`. Ba cờ + một khoảng = 4 nguồn sự thật là công
// thức chắc chắn sinh trạng thái mâu thuẫn (status=CLOSED nhưng isActive=true), và ràng
// buộc US-06 AC3 ("không xoá pháp nhân khi còn đơn vị ACTIVE") sẽ thành không xác định.
//
// LUẬT: `isActive` + `deletedAt` vẫn là NGUỒN SỰ THẬT tới hết P4 (luật cứng #2 — không
// đổi hành vi đường cũ). `status` là cột GƯƠNG, thêm vào để P5 (FranchiseContract) có chỗ
// biểu diễn SUSPENDED/CLOSED. Write path đồng bộ hai chiều; test bất biến chặn tổ hợp lệch.

import type { OrgUnitNode, OrgUnitStatus } from "./types";

/** Gương của `isActive` — dùng ở MỌI đường ghi để hai cột không bao giờ lệch. */
export function statusFromIsActive(isActive: boolean): OrgUnitStatus {
  return isActive ? "ACTIVE" : "SUSPENDED";
}

/** Gương ngược — dùng khi người dùng đổi `status` trên UI. CLOSED cũng là "không hoạt động". */
export function isActiveFromStatus(status: OrgUnitStatus): boolean {
  return status === "ACTIVE";
}

/**
 * "Còn sống" — KHÔNG xét khoảng hiệu lực. Đây là bản thay thế cho `isLive()` cục bộ từng
 * nằm rải rác ở org-tree.ts / actor.ts: bất kỳ cờ nào báo chết thì chết (fail-closed).
 */
export function isOrgUnitLive(n: OrgUnitNode): boolean {
  if (n.deletedAt != null) return false;
  if (n.isActive === false) return false;
  if (n.status != null && n.status !== "ACTIVE") return false;
  return true;
}

/**
 * "Đang hiệu lực tại thời điểm `at`" — isOrgUnitLive + trong [effectiveFrom, effectiveTo].
 * Không đặt hạn = vô thời hạn (giống UserOrgRole). Dùng cho resolver quyền và cho ràng
 * buộc US-06 AC3.
 */
export function isOrgUnitActiveAt(n: OrgUnitNode, at: Date = new Date()): boolean {
  if (!isOrgUnitLive(n)) return false;
  if (n.effectiveFrom != null && n.effectiveFrom > at) return false;
  if (n.effectiveTo != null && n.effectiveTo < at) return false;
  return true;
}
