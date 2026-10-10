"use server";

// R7-06 — server-action wrappers (mỏng): auth + checkPermission("classes:edit") + scope cơ sở.
// Class LÀ center-scoped → một QL@CS2 KHÔNG được điều chỉnh buổi của lớp CS1
// (scopedDb tự inject centerId; passesScope giữ thêm cho rõ ý — R7-06-C7).
// Logic nghiệp vụ nằm ở lib/classes/* (snapshot, adjust); file này chỉ gác cổng.
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { scopedDb, passesScope } from "@/lib/db-scope";
import { checkPermission } from "@/lib/auth/check-permission";
import { resolveActor, type Actor } from "@/lib/auth/actor";
import { getAuditActor } from "@/lib/audit/log";
import { adoptCurriculumVersion } from "@/lib/classes/snapshot";
import { cancelSession, adjustSession } from "@/lib/classes/adjust";
import { nghiBuoiLop, LoiNghiBuoi } from "@/lib/classes/lui-lich";
import { resolveClassSlots, startTimeForWeekday, parseHm } from "@/lib/classes/slots";
import { slotForDate } from "@/lib/classes/phases";
import { loadClassPhases } from "@/lib/classes/phases-service";
import { parseVnYmd, vnDateAt, vnParts } from "@/lib/time/vn";

type Result = { ok: boolean; error?: string };

type Gate = {
  sdb: ReturnType<typeof scopedDb>;
  actor: Actor;
  actorId: string | null;
  actorName: string;
};

/** Cổng chung: đăng nhập + quyền classes:edit + actor/scopedDb. */
async function gate(): Promise<{ ok: true; gate: Gate } | { ok: false; error: string }> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: "Chưa đăng nhập" };
  if (!(await checkPermission("classes:edit"))) {
    return { ok: false, error: "Không có quyền chỉnh sửa lớp" };
  }
  const actor = await resolveActor(session.user.id);
  const { actorId, actorName } = getAuditActor(session);
  return { ok: true, gate: { sdb: scopedDb(actor), actor, actorId, actorName } };
}

/** Lớp thuộc cơ sở của actor? (scopedDb đã lọc; passesScope phòng vệ thêm.) */
function inScope(centerId: string | null | undefined, actor: Actor): boolean {
  return passesScope("Class", { centerId: centerId ?? null }, actor);
}

// ─── Chương trình (ClassSessionPlan) ────────────────────────────────────────

/** Sửa 1 dòng kế hoạch buổi (tiêu đề tuỳ biến / ghi chú / thứ tự hiển thị). */
export async function updateSessionPlan(
  planId: string,
  input: { customTitle?: string | null; note?: string | null; order?: number },
): Promise<Result> {
  const g = await gate();
  if (!g.ok) return { ok: false, error: g.error };
  const { sdb, actor } = g.gate;

  const plan = await sdb.classSessionPlan.findUnique({
    where: { id: planId },
    select: { classId: true, class: { select: { centerId: true } } },
  });
  if (!plan) return { ok: false, error: "Không tìm thấy kế hoạch buổi" };
  if (!inScope(plan.class?.centerId, actor)) {
    return { ok: false, error: "Lớp không thuộc cơ sở bạn quản lý" };
  }

  const data: { customTitle?: string | null; note?: string | null; order?: number } = {};
  if (input.customTitle !== undefined) {
    const t = input.customTitle?.trim();
    data.customTitle = t ? t : null;
  }
  if (input.note !== undefined) {
    const n = input.note?.trim();
    data.note = n ? n : null;
  }
  if (input.order !== undefined && Number.isFinite(input.order)) {
    data.order = Math.trunc(input.order);
  }

  try {
    await sdb.classSessionPlan.update({ where: { id: planId }, data });
  } catch {
    return { ok: false, error: "Không lưu được kế hoạch buổi" };
  }

  revalidatePath(`/classes/${plan.classId}/edit`);
  return { ok: true };
}

/** Áp dụng version giáo trình mới cho lớp (bắt buộc nhập lý do). */
export async function adoptCurriculumVersionAction(
  classId: string,
  version: number,
  reason: string,
): Promise<Result> {
  const g = await gate();
  if (!g.ok) return { ok: false, error: g.error };
  const { sdb, actor, actorId, actorName } = g.gate;

  const cls = await sdb.class.findFirst({
    where: { id: classId, deletedAt: null },
    select: { id: true, centerId: true },
  });
  if (!cls || !inScope(cls.centerId, actor)) {
    return { ok: false, error: "Lớp không thuộc cơ sở bạn quản lý" };
  }

  const trimmed = (reason ?? "").trim();
  if (trimmed.length < 5) {
    return { ok: false, error: "Nhập lý do áp dụng version mới (≥5 ký tự)" };
  }
  if (!Number.isFinite(version) || version <= 0) {
    return { ok: false, error: "Version không hợp lệ" };
  }

  let r;
  try {
    r = await adoptCurriculumVersion({
      classId,
      version: Math.trunc(version),
      reason: trimmed,
      actorId,
      actorName,
    });
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Không áp dụng được version mới" };
  }
  if (!r.ok) return { ok: false, error: r.error ?? "Không áp dụng được version mới" };

  revalidatePath(`/classes/${classId}/edit`);
  return { ok: true };
}

// ─── Điều chỉnh buổi học (ClassSession) ─────────────────────────────────────

/** Tìm + kiểm tra scope buổi học theo lớp chứa nó. */
async function resolveSessionInScope(
  g: Gate,
  sessionId: string,
): Promise<{ ok: true; classId: string; date: Date } | { ok: false; error: string }> {
  const s = await g.sdb.classSession.findUnique({
    where: { id: sessionId },
    select: { classId: true, date: true, class: { select: { centerId: true } } },
  });
  if (!s) return { ok: false, error: "Không tìm thấy buổi học" };
  if (!inScope(s.class?.centerId, g.actor)) {
    return { ok: false, error: "Lớp không thuộc cơ sở bạn quản lý" };
  }
  return { ok: true, classId: s.classId, date: s.date };
}

/** Huỷ 1 buổi học (bắt buộc lý do). Không xoá — set status CANCELLED. */
export async function cancelSessionAction(sessionId: string, reason: string): Promise<Result> {
  const g = await gate();
  if (!g.ok) return { ok: false, error: g.error };

  const sc = await resolveSessionInScope(g.gate, sessionId);
  if (!sc.ok) return { ok: false, error: sc.error };

  const trimmed = (reason ?? "").trim();
  if (trimmed.length < 5) {
    return { ok: false, error: "Nhập lý do huỷ buổi (≥5 ký tự)" };
  }

  let r;
  try {
    r = await cancelSession({
      sessionId,
      reason: trimmed,
      actorId: g.gate.actorId,
      actorName: g.gate.actorName,
    });
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Không huỷ được buổi học" };
  }
  if (!r.ok) return { ok: false, error: r.error ?? "Không huỷ được buổi học" };

  revalidatePath(`/classes/${sc.classId}/edit`);
  revalidatePath("/sessions");
  return { ok: true };
}

/**
 * 27/09/2026 — NGHỈ BUỔI NÀY CỦA RIÊNG LỚP + LÙI CẢ LỊCH LỚP MỘT NHỊP.
 *
 * Khác "Huỷ" (R7-06: buổi bù mang cùng bài đặt sau buổi cuối 7 ngày ⇒ bài rơi xuống cuối
 * khoá) và khác Ngày nghỉ trung tâm (`Holiday` — chấm công nhân sự đọc nó). Dùng khi trung
 * tâm VẪN làm nhưng lớp này không dạy (sự kiện…): buổi này thành "Đã huỷ" ghi lý do, NỘI DUNG
 * BÀI lùi một buổi, cuối khoá thêm một buổi. Áp được cả buổi đã qua. Luật ở
 * `lib/classes/lui-lich.ts` (`nghiBuoiLop`).
 */
export async function nghiBuoiLuiLichAction(sessionId: string, lyDo: string): Promise<Result> {
  const g = await gate();
  if (!g.ok) return { ok: false, error: g.error };

  const sc = await resolveSessionInScope(g.gate, sessionId);
  if (!sc.ok) return { ok: false, error: sc.error };

  const trimmed = (lyDo ?? "").trim();
  if (trimmed.length < 5) return { ok: false, error: "Nhập lý do lớp nghỉ (≥5 ký tự)" };

  // 27/09/2026 — áp được cả buổi ĐÃ QUA (chủ dự án chốt "lùi TÊN BÀI"): ngày + điểm danh của
  // các buổi sau giữ nguyên, chỉ nội dung bài lùi một buổi. Cổng "buổi đã có dữ liệu" nằm
  // trong `nghiBuoiLop` (và được đọc lại trong giao dịch).
  try {
    await nghiBuoiLop({
      sessionId,
      actor: { id: g.gate.actorId, name: g.gate.actorName },
      lyDo: trimmed,
    });
  } catch (err) {
    if (err instanceof LoiNghiBuoi) return { ok: false, error: err.message };
    return { ok: false, error: err instanceof Error ? err.message : "Không lùi được lịch" };
  }

  revalidatePath(`/classes/${sc.classId}`);
  revalidatePath(`/classes/${sc.classId}/edit`);
  revalidatePath("/sessions");
  return { ok: true };
}

/** Điều chỉnh 1 buổi: đổi ngày / GV / phòng. */
export async function adjustSessionAction(
  sessionId: string,
  input: { date?: string | null; teacherId?: string | null; roomId?: string | null },
): Promise<Result> {
  const g = await gate();
  if (!g.ok) return { ok: false, error: g.error };

  const sc = await resolveSessionInScope(g.gate, sessionId);
  if (!sc.ok) return { ok: false, error: sc.error };

  const patch: { date?: Date; teacherId?: string; roomId?: string } = {};
  if (input.date) {
    // Ô nhập là `<input type="date">` → chỉ có "YYYY-MM-DD", KHÔNG có giờ.
    // `new Date("2026-06-25")` cho nửa đêm UTC ⇒ trên server UTC buổi bị đẩy về
    // 07:00 VN, mất khung giờ lớp. Đọc ngày theo lịch VN rồi gắn lại giờ của
    // ĐÚNG thứ đó; thứ nằm ngoài lịch lớp (buổi bù) → giữ nguyên giờ buổi cũ.
    const day = parseVnYmd(input.date);
    if (!day) return { ok: false, error: "Ngày không hợp lệ" };

    // 07/08 — lớp có KẾ HOẠCH nhiều giai đoạn thì giờ phải lấy theo giai đoạn phủ NGÀY
    // MỚI, không theo lịch phẳng (bản sao của giai đoạn đang hiệu lực). Dời buổi từ
    // 17/08 sang 10/09 mà lấy giờ giai đoạn cũ là buổi lệch 9 tiếng so với cả lớp.
    const loaded = await loadClassPhases(sc.classId);
    const phaseSlot =
      loaded && !loaded.isDerived ? slotForDate(loaded.phases, day) : null;

    let hm: string | null = phaseSlot?.startTime ?? null;
    if (!hm) {
      const cls = await g.gate.sdb.class.findUnique({
        where: { id: sc.classId },
        select: {
          scheduleDays: true,
          startTime: true,
          endTime: true,
          scheduleSlots: { select: { weekday: true, startTime: true, endTime: true } },
        },
      });
      const slots = resolveClassSlots({
        scheduleDays: cls?.scheduleDays ?? [],
        startTime: cls?.startTime,
        endTime: cls?.endTime,
        slots: cls?.scheduleSlots,
      });
      hm = startTimeForWeekday(slots, vnParts(day).weekday);
    }
    const p = vnParts(day);
    const time = hm ? parseHm(hm) : { h: vnParts(sc.date).hour, m: vnParts(sc.date).minute };
    patch.date = vnDateAt(p.year, p.month, p.day, time.h, time.m);
  }
  if (input.teacherId) patch.teacherId = input.teacherId;
  if (input.roomId) patch.roomId = input.roomId;

  if (Object.keys(patch).length === 0) {
    return { ok: false, error: "Chưa có thay đổi nào để áp dụng" };
  }

  let r;
  try {
    r = await adjustSession({
      sessionId,
      ...patch,
      actorId: g.gate.actorId,
      actorName: g.gate.actorName,
    });
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Không điều chỉnh được buổi học" };
  }
  if (!r.ok) return { ok: false, error: r.error ?? "Không điều chỉnh được buổi học" };

  revalidatePath(`/classes/${sc.classId}/edit`);
  revalidatePath("/sessions");
  return { ok: true };
}
