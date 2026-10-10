// lib/actions/factory.ts — R6-D1: Action factory chuẩn (Doc 15 §4 / BA #04 V2).
//
// Một pipeline duy nhất cho mọi Server Action ghi dữ liệu, để không action nào
// "quên" bước bảo mật/kiểm toán:
//   auth → resolveActor → zod → can(target) → scopedDb → mutation → writeAudit → revalidate
//
// Tách 2 lớp (như R6-A service/action):
//  - runAction(): THUẦN logic (nhận Actor đã resolve) → test được không cần request.
//    KHÔNG import next-auth/next-cache ở file này (giữ test node context chạy được).
//  - defineAction(): binding Next (auth() + resolveActor + revalidatePath) ở lib/actions/define.ts.
//
// Lưu ý thứ tự: zod parse TRƯỚC can() vì `target` (scope CENTER/OWN/...) suy ra từ
// input đã hợp lệ. Đây là điều chỉnh có chủ đích so với "can→zod" ở mô tả BA —
// kiểm tra quyền vẫn chạy trước mọi mutation, và input không hợp lệ bị chặn sớm.
import type { z } from "zod";
import type { Actor, Target } from "@/lib/auth/actor";
// US-02 (Nền Hệ thống P0): can() HỢP NHẤT — grant PermissionGrant mới ưu tiên,
// không grant khớp → fallback nguyên trạng can() v2. An toàn: 0 consumer production
// của factory (3 file chỉ import type ScopedDb); bảng grant ship rỗng = zero change.
import { can } from "@/lib/permissions/can";
import { scopedDb } from "@/lib/db-scope";
import { writeAudit } from "@/lib/audit/audit-log";

/** Lỗi nghiệp vụ trong handler → factory chuyển thành ActionResult lỗi (không throw ra ngoài). */
export class ActionError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly field?: string,
  ) {
    super(message);
    this.name = "ActionError";
  }
}

export type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: string; message: string; field?: string } };

/** Client scopedDb truyền vào handler. */
export type ScopedDb = ReturnType<typeof scopedDb>;

/** handler trả về: data (gửi client) + metadata để ghi audit + path revalidate động. */
export type HandlerOutput<T> = {
  /** id entity bị tác động — vào AuditLog.entityId. */
  entityId: string;
  /** Dữ liệu trả về client. */
  data: T;
  oldValues?: Record<string, unknown> | null;
  newValues?: Record<string, unknown> | null;
  /** orgUnitId cho audit scope (mặc định null). */
  orgUnitId?: string | null;
  /** Path revalidate động bổ sung (ngoài cfg.revalidate tĩnh). */
  revalidate?: string[];
};

export type HandlerCtx<I> = {
  db: ScopedDb;
  actor: Actor;
  input: I;
  reason: string | null;
};

export type ActionConfig<I, T> = {
  /** Tên (debug/log). */
  name: string;
  /** Action string trong action-registry (vd "leads:edit"). */
  permission: string;
  schema: z.ZodType<I>;
  /** Suy `Target` từ input cho can() (scope CENTER/OWN/CLASS...). Bỏ trống = GLOBAL check. */
  target?: (input: I) => Target;
  /** Bắt buộc lý do (đổi cấu hình/tiền) → thiếu = VALIDATION field "reason". */
  requireReason?: boolean;
  /** module + entityType cho AuditLog. */
  module: string;
  entityType: string;
  /** action audit: CREATE/UPDATE/DELETE (mặc định UPDATE). */
  auditAction?: string;
  /** Path tĩnh revalidate sau khi ok. */
  revalidate?: string[];
  handler: (ctx: HandlerCtx<I>) => Promise<HandlerOutput<T>>;
};

function fail(code: string, message: string, field?: string): { ok: false; error: { code: string; message: string; field?: string } } {
  return { ok: false, error: { code, message, field } };
}

/**
 * Lõi THUẦN — nhận Actor đã resolve. Trả về { result, paths } để lớp Next revalidate.
 * Test gọi trực tiếp với actor seed (không cần request/auth()).
 */
export async function runAction<I, T>(
  cfg: ActionConfig<I, T>,
  actor: Actor,
  rawInput: unknown,
  meta: { actorName: string; reason?: string | null },
): Promise<{ res: ActionResult<T>; paths: string[] }> {
  const noPaths: string[] = [];

  // 1) zod — input hợp lệ trước (để suy target).
  const parsed = cfg.schema.safeParse(rawInput);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return {
      res: fail("VALIDATION", issue?.message ?? "Dữ liệu không hợp lệ", issue?.path.join(".")),
      paths: noPaths,
    };
  }
  const input = parsed.data;

  // 2) reason bắt buộc (nếu yêu cầu).
  const reason = meta.reason ?? null;
  if (cfg.requireReason && !reason?.trim()) {
    return { res: fail("VALIDATION", "Lý do thay đổi là bắt buộc", "reason"), paths: noPaths };
  }

  // 3) can(actor, action, target) — quyền trước mọi mutation.
  const target = cfg.target?.(input);
  if (!can(actor, cfg.permission, target)) {
    return { res: fail("PERMISSION_DENIED", "Không có quyền thực hiện thao tác này"), paths: noPaths };
  }

  // 4) scopedDb + handler (mutation).
  const sdb = scopedDb(actor);
  let out: HandlerOutput<T>;
  try {
    out = await cfg.handler({ db: sdb, actor, input, reason });
  } catch (e) {
    if (e instanceof ActionError) return { res: fail(e.code, e.message, e.field), paths: noPaths };
    throw e; // lỗi hệ thống → để Next/Sentry bắt
  }

  // 5) audit (immutable).
  await writeAudit({
    actor: { id: actor.userId, name: meta.actorName },
    module: cfg.module,
    entityType: cfg.entityType,
    entityId: out.entityId,
    action: cfg.auditAction ?? "UPDATE",
    oldValues: out.oldValues ?? null,
    newValues: out.newValues ?? null,
    reason: reason ?? undefined,
    orgUnitId: out.orgUnitId ?? null,
  });

  // 6) gom path revalidate (tĩnh + động).
  const paths = [...(cfg.revalidate ?? []), ...(out.revalidate ?? [])];
  return { res: { ok: true, data: out.data }, paths };
}

export { fail as actionFail };
