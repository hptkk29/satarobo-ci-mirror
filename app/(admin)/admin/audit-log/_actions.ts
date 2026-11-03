"use server";

import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { checkPermission, assertPermission } from "@/lib/auth/check-permission";
import { resolveActor } from "@/lib/auth/actor";
import { PermissionError } from "@/lib/auth/can";
import { scopedDb } from "@/lib/db-scope";
import { getAuditActor } from "@/lib/audit/log";
import { getRequestMetadata } from "@/lib/audit/headers";
import { breakGlassSchema } from "@/lib/validators/audit";
import {
  queryUnifiedAuditLogs,
  recordPiiUnmask,
  writeAudit,
  type UnifiedAuditFilters,
  type UnifiedAuditRow,
} from "@/lib/audit/audit-log";
import type { Session } from "next-auth";

const EXPORT_CAP = 5000;
const RETENTION_DAYS = 365;

// #05 — Viewer đọc bảng AuditLog HỢP NHẤT (KHÔNG 5 bảng legacy). Gate view = quyền
// `audit-logs:view` (sửa nợ: trước đây requireAuditView dùng `users:manage` trong khi
// page.tsx dùng `audit-logs:view` → CENTER_MANAGER thấy menu nhưng mọi action fail).
async function requireAuditView(): Promise<Session> {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!(await checkPermission("audit-logs:view"))) {
    redirect("/dashboard?error=unauthorized");
  }
  return session;
}

// Thao tác phá hủy (prune retention) giữ gate MẠNH `users:manage` (SUPER_ADMIN) —
// KHÔNG hạ theo audit-logs:view (tránh CENTER_MANAGER xoá được audit).
async function requireAuditCleanup(): Promise<Session> {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!(await checkPermission("users:manage"))) {
    redirect("/dashboard?error=unauthorized");
  }
  return session;
}

// LOCAL only — KHÔNG export (file 'use server' chỉ được export async function). Kiểu
// cho UI ở `./_types.ts`.
type AuditFilters = UnifiedAuditFilters;

// ─── QUERY (mask mặc định + break-glass) ─────────────────────────────────────
/**
 * Query viewer hợp nhất. `unmask=true` (break-glass) chỉ có hiệu lực khi actor
 * thực sự có quyền `audit-logs:view-pii` — RE-CHECK mỗi lần (defense in depth,
 * không tin cờ client). Không đủ quyền → im lặng trả bản MASK (an toàn).
 */
export async function queryAuditLogs(
  filters: AuditFilters,
  cursor: string | null,
  unmask = false,
): Promise<{ items: UnifiedAuditRow[]; nextCursor: string | null }> {
  const session = await requireAuditView();
  const actor = await resolveActor(session.user.id);
  const effectiveUnmask = unmask && (await checkPermission("audit-logs:view-pii"));
  return queryUnifiedAuditLogs(actor, filters, cursor, { unmask: effectiveUnmask });
}

// ─── BREAK-GLASS: mở PII cho phiên xem (câu 13 BGĐ) ──────────────────────────
/**
 * Bấm "Xem đầy đủ" → nhập lý do (>=10 ký tự) → server verify quyền view-pii +
 * ghi log RIÊNG `audit.pii-unmasked` (ai – lúc nào – lý do). Trả ok để client
 * chuyển sang chế độ unmask cho phiên; query sau đó vẫn re-check quyền.
 */
export async function revealAuditPii(
  input: unknown,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await requireAuditView();

  try {
    await assertPermission("audit-logs:view-pii");
  } catch (e) {
    if (e instanceof PermissionError) {
      return { ok: false, error: "Bạn không có quyền xem đầy đủ PII" };
    }
    throw e;
  }

  const parsed = breakGlassSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Lý do không hợp lệ" };
  }

  const { actorId, actorName } = getAuditActor(session);
  const meta = await getRequestMetadata();
  await recordPiiUnmask({ id: actorId, name: actorName }, parsed.data.reason, {
    ip: meta.ip ?? null,
    userAgent: meta.userAgent ?? null,
  });

  return { ok: true };
}

// ─── EXPORT CSV (mask mặc định — KHÔNG bao giờ leak raw PII qua bulk export) ──
function csvEscape(val: unknown): string {
  if (val === null || val === undefined) return "";
  const str =
    typeof val === "object" && !(val instanceof Date)
      ? JSON.stringify(val)
      : val instanceof Date
        ? val.toISOString()
        : String(val);
  if (str.includes(",") || str.includes('"') || str.includes("\n")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export async function exportAuditLogsCSV(
  filters: AuditFilters,
): Promise<
  | { ok: true; csv: string; filename: string }
  | { ok: false; error: string }
> {
  const session = await requireAuditView();
  const actor = await resolveActor(session.user.id);

  // Bulk export = rủi ro PII cao nhất → LUÔN mask (break-glass chỉ áp cho xem từng
  // dòng trên UI, không mở qua CSV).
  const { items } = await queryUnifiedAuditLogs(actor, filters, null, {
    take: EXPORT_CAP,
    unmask: false,
  });

  const headers = [
    "createdAt",
    "module",
    "entityType",
    "entityId",
    "action",
    "actorName",
    "changedFields",
    "reason",
    "oldValues",
    "newValues",
    "orgUnitId",
    "ip",
    "userAgent",
  ];
  const lines: string[] = [headers.join(",")];
  for (const r of items) {
    lines.push(
      [
        csvEscape(r.createdAt),
        csvEscape(r.module),
        csvEscape(r.entityType),
        csvEscape(r.entityId),
        csvEscape(r.action),
        csvEscape(r.actorName),
        csvEscape(r.changedFields.join("|")),
        csvEscape(r.reason),
        csvEscape(r.oldValues),
        csvEscape(r.newValues),
        csvEscape(r.orgUnitId),
        csvEscape(r.ip),
        csvEscape(r.userAgent),
      ].join(","),
    );
  }

  // Audit lại chính hành động export (CLAUDE.md: export nhạy cảm có audit).
  const { actorId, actorName } = getAuditActor(session);
  await writeAudit({
    actor: { id: actorId, name: actorName },
    module: "audit",
    entityType: "AuditLog",
    entityId: "*",
    action: "EXPORT",
    reason: `Export audit log (${items.length} dòng, đã mask PII)`,
  });

  const csv = "﻿" + lines.join("\n");
  const dateStr = new Date().toISOString().slice(0, 10);
  const filename = `audit-log-${dateStr}.csv`;
  return { ok: true, csv, filename };
}

// ─── CLEANUP >365 DAYS (prune 5 bảng legacy — read-only history) ─────────────
// GIỮ prune 5 bảng legacy (chưa freeze-legacy — 58 writer vẫn ghi, HOÃN). Bảng
// AuditLog hợp nhất KHÔNG xoá ở đây (immutable — A0-06 AC4). Gate SUPER_ADMIN.
export async function cleanupOldAuditLogs(): Promise<
  | {
      ok: true;
      deleted: {
        user: number;
        grant: number;
        lead: number;
        class: number;
        student: number;
      };
    }
  | { ok: false; error: string }
> {
  const session = await requireAuditCleanup();
  const sdb = scopedDb(await resolveActor(session.user.id));

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - RETENTION_DAYS);

  const [user, grant, lead, cls, student] = await sdb.$transaction([
    sdb.userAuditLog.deleteMany({ where: { createdAt: { lt: cutoff } } }),
    sdb.permissionGrantAuditLog.deleteMany({
      where: { createdAt: { lt: cutoff } },
    }),
    sdb.leadAuditLog.deleteMany({ where: { createdAt: { lt: cutoff } } }),
    sdb.classAuditLog.deleteMany({ where: { createdAt: { lt: cutoff } } }),
    sdb.studentAuditLog.deleteMany({ where: { createdAt: { lt: cutoff } } }),
  ]);

  return {
    ok: true,
    deleted: {
      user: user.count,
      grant: grant.count,
      lead: lead.count,
      class: cls.count,
      student: student.count,
    },
  };
}
