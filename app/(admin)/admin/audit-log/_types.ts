// Kiểu dùng chung cho UI audit-log. TÁCH khỏi `_actions.ts` (`'use server'`) vì file
// server-action CHỈ được export async function — export type/re-export type trong đó bị
// Turbopack biến thành tham chiếu runtime → `ReferenceError: X is not defined` khi POST.
import type { UnifiedAuditFilters, UnifiedAuditRow } from "@/lib/audit/audit-log";

export type AuditFilters = UnifiedAuditFilters;
export type { UnifiedAuditRow };
