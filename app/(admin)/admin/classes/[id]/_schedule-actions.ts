"use server";

// KẾ HOẠCH LỊCH HỌC NHIỀU GIAI ĐOẠN (07/08/2026) — server-action mỏng.
//
// Cổng: đăng nhập + `classes:edit` + scope cơ sở (Class ∈ SCOPED_MODELS; scopedDb chỉ
// che READ nên write vẫn phải tự `passesScope`). Logic nằm ở `lib/classes/phases*.ts`.
//
// Ba việc:
//   • `saveSchedulePhasesAction` — lưu kế hoạch (thay toàn bộ) + đồng bộ bản sao lịch cũ.
//   • `previewApplyScheduleAction` — xem trước dời buổi kể từ ngày áp dụng (KHÔNG ghi).
//   • `applyScheduleAction` — áp dụng: chỉ đổi `date`, KHÔNG tạo/xoá buổi.
//
// ⚠️ Ngày do người dùng chọn (`<input type="date">`) phải đi qua `parseVnYmd` (00:00 giờ
// VN). Dùng `new Date("2026-08-12")` hay `z.coerce.date()` sẽ ra nửa đêm UTC = 07:00 VN
// và ăn mất buổi sáng của đúng ngày áp dụng.

import { revalidatePath } from "next/cache";
import type { Prisma } from "@prisma/client";
import { auth } from "@/lib/auth";
import { scopedDb, passesScope } from "@/lib/db-scope";
import { checkPermission } from "@/lib/auth/check-permission";
import { resolveActor, type Actor } from "@/lib/auth/actor";
import { getAuditActor, logClassAudit } from "@/lib/audit/log";
import { publishEvent } from "@/lib/events/publish";
import { detectBatchConflicts } from "@/lib/lms/schedule-conflict";
import { formatDateVN } from "@/lib/format/date";
import {
  findScheduleGaps,
  phaseInputsToDomain,
  slotForDate,
  validatePhases,
  WEEKDAY_LABELS,
  type SchedulePhase,
} from "@/lib/classes/phases";
import {
  loadClassConflictInfo,
  loadClassPhases,
  persistPhases,
  planScheduleApply,
  type ReschedulePlanItem,
} from "@/lib/classes/phases-service";
import type { SchedulePhaseInput } from "@/lib/classes/phase-form";
import { parseVnYmd, vnDateOnly, vnStartOfDay, vnYmd } from "@/lib/time/vn";

type Result = { ok: boolean; error?: string; warning?: string };

// Kế hoạch gửi từ form dùng hình dạng chung `SchedulePhaseInput` — import thẳng
// từ `lib/classes/phase-form`. KHÔNG re-export type ở đây: file "use server" bắt
// mọi export phải là async action; loader sinh export value cho tên type-only
// → ReferenceError lúc eval module, chết TOÀN BỘ action tạo/sửa lớp (bug 09/08).

type Gate = {
  actor: Actor;
  sdb: ReturnType<typeof scopedDb>;
  actorId: string | null;
  actorName: string;
};

async function gate(
  classId: string,
): Promise<{ ok: true; gate: Gate; centerId: string | null } | { ok: false; error: string }> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: "Chưa đăng nhập" };
  if (!(await checkPermission("classes:edit"))) {
    return { ok: false, error: "Không có quyền chỉnh sửa lớp" };
  }
  const actor = await resolveActor(session.user.id);
  const sdb = scopedDb(actor);
  // select centerId là BẮT BUỘC trên model scoped — thiếu thì findFirst trả null nhầm.
  const cls = await sdb.class.findFirst({
    where: { id: classId, deletedAt: null },
    select: { id: true, centerId: true },
  });
  if (!cls) return { ok: false, error: "Lớp không tồn tại" };
  if (!passesScope("Class", { centerId: cls.centerId }, actor)) {
    return { ok: false, error: "Lớp không tồn tại" };
  }
  const { actorId, actorName } = getAuditActor(session);
  return { ok: true, gate: { actor, sdb, actorId, actorName }, centerId: cls.centerId };
}

/** Form → domain (dùng chung với form tạo/sửa lớp). Ngày rỗng ở ô "đến" = giai đoạn mở. */
const toDomainPhases = phaseInputsToDomain;

/**
 * Mốc áp dụng: "YYYY-MM-DD" → 00:00 giờ VN, KHÔNG cho ở quá khứ.
 *
 * Action cũ chốt cứng mốc ≥ ngày mai. Nay cho chọn, nhưng vẫn phải chặn quá khứ: buổi
 * đã DIỄN RA mà chưa kịp điểm danh vẫn ở trạng thái SCHEDULED nên sẽ bị coi là "trống"
 * và bị dời ngày — kèm theo đó là thông báo đổi lịch bắn tới phụ huynh cho một buổi đã học.
 */
function parseApplyFrom(
  value: string,
): { ok: true; date: Date } | { ok: false; error: string } {
  const from = parseVnYmd(value ?? "");
  if (!from) return { ok: false, error: "Chọn ngày áp dụng lịch mới." };
  const today = vnStartOfDay(new Date());
  if (from.getTime() < today.getTime()) {
    return {
      ok: false,
      error: `Ngày áp dụng không được ở quá khứ (sớm nhất là hôm nay, ${vnYmd(today)}) — buổi đã diễn ra thì không dời được.`,
    };
  }
  return { ok: true, date: from };
}

function revalidateClass(classId: string) {
  // Cả 2 màn sửa lớp cùng tồn tại — revalidate 1 chỗ là màn kia stale (bẫy đã ghi nhận).
  revalidatePath(`/classes/${classId}`);
  revalidatePath(`/classes/${classId}/edit`);
  revalidatePath("/classes");
  revalidatePath("/sessions");
}

// ─── Lưu kế hoạch ────────────────────────────────────────────────────────────

/**
 * Lưu kế hoạch lịch (thay toàn bộ). KHÔNG tự dời buổi đã sinh — dời là thao tác riêng,
 * có xem trước, vì nó đụng lịch mà phụ huynh đã biết.
 */
export async function saveSchedulePhasesAction(
  classId: string,
  input: SchedulePhaseInput[],
  reason?: string,
): Promise<Result> {
  const g = await gate(classId);
  if (!g.ok) return g;

  const mapped = toDomainPhases(input);
  if (!mapped.ok) return mapped;

  const errors = validatePhases(mapped.phases);
  if (errors.length > 0) return { ok: false, error: errors.join(" ") };

  const before = await loadClassPhases(classId);
  const now = new Date();

  try {
    await g.gate.sdb.$transaction(async (txRaw) => {
      const tx = txRaw as unknown as Prisma.TransactionClient;
      await persistPhases(tx, classId, mapped.phases, now);
      await logClassAudit({
        classId,
        action: "UPDATE",
        actorId: g.gate.actorId,
        actorName: g.gate.actorName,
        oldValues: { schedulePhases: before ? describePhases(before.phases) : [] },
        newValues: { schedulePhases: describePhases(mapped.phases) },
        changedFields: ["schedulePhases", "scheduleDays", "startTime", "endTime"],
        reason: reason?.trim() || "Cập nhật kế hoạch lịch học",
        tx,
      });
    });
  } catch (err) {
    return { ok: false, error: `Lỗi lưu kế hoạch: ${err instanceof Error ? err.message : "Unknown"}` };
  }

  revalidateClass(classId);
  const gaps = findScheduleGaps(mapped.phases);
  return {
    ok: true,
    ...(gaps.length > 0
      ? {
          warning: `Lớp KHÔNG có buổi trong khoảng ${gaps
            .map((x) => `${x.fromKey} → ${x.toKey}`)
            .join(", ")} (khoảng trống giữa các giai đoạn).`,
        }
      : {}),
  };
}

/** Mô tả gọn 1 kế hoạch cho AuditLog (đọc được, không phải bãi JSON). */
function describePhases(phases: SchedulePhase[]) {
  return phases.map((p) => ({
    from: vnYmd(p.effectiveFrom),
    to: p.effectiveTo ? vnYmd(p.effectiveTo) : null,
    slots: p.slots
      .map((s) => `${WEEKDAY_LABELS[s.weekday] ?? s.weekday} ${s.startTime}${s.endTime ? `-${s.endTime}` : ""}`)
      .join(", "),
  }));
}

// ─── Xem trước / áp dụng ─────────────────────────────────────────────────────

export interface PreviewRow {
  id: string;
  topic: string | null;
  oldDate: string;
  newDate: string | null;
  keepReason: string | null;
}

export interface PreviewResult {
  ok: true;
  rows: PreviewRow[];
  changedCount: number;
  keptCount: number;
  conflicts: { date: string; messages: string[] }[];
  newEndDate: string | null;
}

/** Xem trước dời buổi kể từ ngày áp dụng — KHÔNG ghi gì. */
export async function previewApplyScheduleAction(
  classId: string,
  applyFrom: string,
  phasesOverride?: SchedulePhaseInput[],
): Promise<PreviewResult | { ok: false; error: string }> {
  const g = await gate(classId);
  if (!g.ok) return g;

  const parsedFrom = parseApplyFrom(applyFrom);
  if (!parsedFrom.ok) return parsedFrom;
  const from = parsedFrom.date;

  let override: SchedulePhase[] | undefined;
  if (phasesOverride && phasesOverride.length > 0) {
    const mapped = toDomainPhases(phasesOverride);
    if (!mapped.ok) return mapped;
    const errors = validatePhases(mapped.phases);
    if (errors.length > 0) return { ok: false, error: errors.join(" ") };
    override = mapped.phases;
  }

  const res = await planScheduleApply({ classId, applyFrom: from, phasesOverride: override });
  if (!res.ok) return res;

  const conflicts = await conflictsForPlan(classId, g.centerId, res.plan.items, override);
  return toPreviewResult(res.plan.items, res.plan.changedCount, conflicts, res.plan.newEndDate);
}

function toPreviewResult(
  items: ReschedulePlanItem[],
  changedCount: number,
  conflicts: { date: Date; messages: string[] }[],
  newEndDate: Date | null,
): PreviewResult {
  return {
    ok: true,
    rows: items.map((it) => ({
      id: it.id,
      topic: it.topic,
      oldDate: it.oldDate.toISOString(),
      newDate: it.newDate ? it.newDate.toISOString() : null,
      keepReason: it.keepReason,
    })),
    changedCount,
    keptCount: items.filter((it) => it.keepReason !== null).length,
    conflicts: conflicts.map((c) => ({ date: c.date.toISOString(), messages: c.messages })),
    newEndDate: newEndDate ? newEndDate.toISOString() : null,
  };
}

/**
 * Soát trùng GV/phòng cho các ngày MỚI, nhóm theo khung giờ THẬT của từng ngày.
 *
 * Trước đây phép soát dùng một khung giờ chung cấp lớp; lớp nhiều giai đoạn khác giờ sẽ
 * báo trùng oan hoặc bỏ sót. Loại chính các buổi đang dời khỏi phép so.
 */
async function conflictsForPlan(
  classId: string,
  centerId: string | null,
  items: ReschedulePlanItem[],
  phasesOverride?: SchedulePhase[],
): Promise<{ date: Date; messages: string[] }[]> {
  void centerId; // soát toàn hệ thống: GV có thể dạy 2 cơ sở
  const cls = await loadClassConflictInfo(classId);
  if (!cls || (!cls.teacherId && !cls.roomId)) return [];

  const loaded = phasesOverride
    ? { phases: phasesOverride }
    : await loadClassPhases(classId);
  const phases = loaded?.phases ?? [];

  const groups = new Map<string, { startTime: string; endTime: string | null; dates: Date[] }>();
  for (const it of items) {
    if (!it.newDate) continue;
    const slot = slotForDate(phases, it.newDate);
    const startTime = slot?.startTime || cls.startTime || "";
    if (!startTime) continue;
    const endTime = slot?.endTime ?? cls.endTime ?? null;
    const key = `${startTime}|${endTime ?? ""}`;
    const g = groups.get(key) ?? { startTime, endTime, dates: [] };
    g.dates.push(it.newDate);
    groups.set(key, g);
  }

  const out: { date: Date; messages: string[] }[] = [];
  for (const g of groups.values()) {
    const found = await detectBatchConflicts({
      centerId: null,
      excludeClassId: classId,
      excludeSessionIds: items.map((it) => it.id),
      classStartTime: g.startTime,
      classEndTime: g.endTime,
      teacherId: cls.teacherId,
      roomId: cls.roomId,
      dates: g.dates,
    }).catch(() => []);
    out.push(...found);
  }
  out.sort((a, b) => a.date.getTime() - b.date.getTime());
  return out;
}

/**
 * Áp dụng lịch mới cho các buổi ĐÃ SINH, kể từ ngày áp dụng.
 *
 * CHỈ đổi `date`. Không tạo, không xoá buổi ⇒ tổng số buổi của khoá không đổi (chốt của
 * chủ dự án) và không đụng `Attendance`/`StudentSessionFeedback` (cascade) hay 9 bảng
 * trỏ vào buổi bằng ref phẳng.
 */
export async function applyScheduleAction(
  classId: string,
  applyFrom: string,
  phases: SchedulePhaseInput[],
  reason?: string,
): Promise<Result & { moved?: number; kept?: number }> {
  const g = await gate(classId);
  if (!g.ok) return g;

  const parsedFrom = parseApplyFrom(applyFrom);
  if (!parsedFrom.ok) return parsedFrom;
  const from = parsedFrom.date;

  // Áp dụng = LƯU kế hoạch + dội xuống buổi, trong CÙNG một transaction. Trước đây
  // "Xem trước" chạy trên kế hoạch đang gõ còn "Áp dụng" chạy trên kế hoạch ĐÃ LƯU ⇒
  // admin duyệt một bảng rồi hệ thống ghi một bảng khác.
  const mapped = toDomainPhases(phases ?? []);
  if (!mapped.ok) return mapped;
  const errors = validatePhases(mapped.phases);
  if (errors.length > 0) return { ok: false, error: errors.join(" ") };

  const res = await planScheduleApply({
    classId,
    applyFrom: from,
    phasesOverride: mapped.phases,
  });
  if (!res.ok) return res;

  const conflicts = await conflictsForPlan(classId, g.centerId, res.plan.items, mapped.phases);
  if (conflicts.length > 0) {
    const days = conflicts.slice(0, 3).map((c) => formatDateVN(c.date));
    const more = conflicts.length > days.length ? ` (+${conflicts.length - days.length} buổi nữa)` : "";
    return {
      ok: false,
      error: `Không áp được: lịch mới trùng phòng/giáo viên với lớp khác vào ${days.join(", ")}${more}. Đổi phòng/GV hoặc sửa kế hoạch rồi thử lại.`,
    };
  }

  const moves = res.plan.items.filter(
    (it) => it.newDate !== null && it.newDate.getTime() !== it.oldDate.getTime(),
  );

  const now = new Date();
  try {
    await g.gate.sdb.$transaction(async (txRaw) => {
      const tx = txRaw as unknown as Prisma.TransactionClient;
      // Chốt kế hoạch trước — lịch và buổi phải khớp nhau, không để lệch nửa vời.
      await persistPhases(tx, classId, mapped.phases, now);
      for (const it of moves) {
        await tx.classSession.update({
          where: { id: it.id },
          data: { date: it.newDate as Date },
        });
      }
      if (res.plan.newEndDate) {
        // vnDateOnly: cột NGÀY dùng quy ước nửa đêm UTC. Bản cũ dùng
        // `new Date(d.getFullYear(), …)` — getter theo TZ máy chạy, lệch trên Vercel.
        await tx.class.update({
          where: { id: classId },
          data: { endDate: vnDateOnly(res.plan.newEndDate) },
        });
      }
      await logClassAudit({
        classId,
        action: "UPDATE",
        actorId: g.gate.actorId,
        actorName: g.gate.actorName,
        oldValues: { sessions: moves.map((m) => ({ id: m.id, date: vnYmd(m.oldDate) })) },
        newValues: {
          applyFrom: vnYmd(from),
          sessions: moves.map((m) => ({ id: m.id, date: vnYmd(m.newDate as Date) })),
          keptCount: res.plan.items.filter((i) => i.keepReason).length,
        },
        changedFields: ["schedulePhases", "sessions.date", "endDate"],
        reason: reason?.trim() || `Áp lịch mới từ ${vnYmd(from)}`,
        tx,
      });
      // 1 event cho cả lô — đừng bắn mỗi buổi 1 lần, phụ huynh sẽ nhận cả chục tin.
      // Không buổi nào đổi ngày ⇒ KHÔNG phát: chỉ là lưu kế hoạch, đừng báo PH vô cớ.
      if (moves.length > 0) {
        await publishEvent(
          "class.session_changed",
          { classId, change: "RESCHEDULED", count: moves.length },
          { tx },
        );
      }
    });
  } catch (err) {
    return { ok: false, error: `Lỗi áp lịch: ${err instanceof Error ? err.message : "Unknown"}` };
  }

  revalidateClass(classId);
  return {
    ok: true,
    moved: moves.length,
    kept: res.plan.items.filter((i) => i.keepReason).length,
  };
}
