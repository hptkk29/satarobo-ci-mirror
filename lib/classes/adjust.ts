import "server-only";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { writeAudit } from "@/lib/audit/audit-log";
import { publishEvent } from "@/lib/events/publish";
import { kiemTrungThaoTacBuoi, rowsToSlots, sessionWindow } from "@/lib/lms/schedule-conflict";
import { vnAddDays } from "@/lib/time/vn";
import { findLockedSessions } from "@/lib/classes/phases-service";

// =============================================================================
// R7-06 — Điều chỉnh buổi học: HỦY buổi (sinh buổi bù cuối lịch, giữ tổng số buổi)
// + CHỈNH buổi (đổi ngày/giáo viên/phòng). Buổi đã COMPLETED bị khoá — không sửa.
// Side-effect (thông báo) đi qua DomainEvent `class.session_changed` (idempotent).
//
// `tx` (đợt 3 đơn từ, 08/10/2026): truyền vào khi phép huỷ/chỉnh là MỘT PHẦN của quyết định lớn
// hơn — duyệt đơn nghỉ dạy / dạy thay. Khi đó hàm KHÔNG mở transaction riêng mà ghi trong giao
// dịch của nơi gọi, nên "đơn APPROVED" và "buổi đã đổi" cùng commit hoặc cùng rollback (BA §14).
// Bỏ trống ⇒ hàm tự mở transaction như cũ (màn lớp học gọi kiểu này).
// =============================================================================

const MAKEUP_GAP_DAYS = 7;

/**
 * PURE — ngày buổi bù: SAU buổi muộn nhất hiện có (mặc định +7 ngày so với max),
 * để "nối thêm 1 buổi ở cuối" giữ nguyên tổng số buổi. existingDates rỗng →
 * +7 ngày so với afterDate.
 */
export function buildMakeupDate(existingDates: Date[], afterDate: Date): Date {
  let latest = afterDate;
  for (const d of existingDates) {
    if (d.getTime() > latest.getTime()) latest = d;
  }
  return vnAddDays(latest, MAKEUP_GAP_DAYS);
}

/**
 * HỦY 1 buổi (status=CANCELLED, KHÔNG xoá) + sinh 1 buổi bù ở cuối lịch (giữ tổng
 * số buổi active). Ghi AuditLog. Buổi đã COMPLETED → không cho huỷ.
 */
export async function cancelSession(opts: {
  sessionId: string;
  reason: string;
  actorId: string | null;
  actorName: string;
  tx?: Prisma.TransactionClient;
  /**
   * Đơn từ sinh ra lượt huỷ này (đợt 11 đơn từ) — ghi lên BUỔI BÙ để huỷ đơn tìm đúng buổi bù của nó.
   * Huỷ buổi từ màn lớp học thì không truyền (null).
   */
  sourceWorkRequestId?: string | null;
}): Promise<{ ok: boolean; makeupSessionId?: string; error?: string }> {
  const { sessionId, reason, actorId, actorName } = opts;
  const client = opts.tx ?? db;
  if (!reason || reason.trim().length === 0) {
    return { ok: false, error: "Lý do (reason) là bắt buộc khi huỷ buổi" };
  }

  const session = await client.classSession.findUnique({
    where: { id: sessionId },
    select: {
      id: true,
      classId: true,
      date: true,
      status: true,
      topic: true,
      lessonId: true,
      planId: true,
      centerId: true,
    },
  });
  if (!session) return { ok: false, error: "Buổi học không tồn tại" };
  if (session.status === "COMPLETED") {
    return { ok: false, error: "Buổi đã hoàn thành — không thể huỷ" };
  }
  if (session.status === "CANCELLED") {
    return { ok: false, error: "Buổi đã bị huỷ trước đó" };
  }

  // 19/08 — KHÔNG huỷ buổi ĐÃ ĐƯỢC DÙNG (đã điểm danh / có nhận xét / đã giao bài / có
  // ảnh lớp). Chặn theo `status` là chưa đủ: điểm danh KHÔNG đổi status buổi (chỉ
  // completeSession đổi, mà nó nằm sau cờ SESSION_LIFECYCLE_V2 đang OFF), nên một buổi đã
  // dạy xong với 20 bản ghi điểm danh vẫn mang nhãn SCHEDULED và huỷ được. Huỷ xong thì
  // buổi đó rơi khỏi mọi phép tính chuyên cần (buổi CANCELLED không tính học, không tính
  // vắng) ⇒ số buổi đã học của cả lớp tụt xuống mà không ai biết vì sao.
  // Dùng chung định nghĩa "buổi đã dùng" với màn đổi lịch (findLockedSessions).
  const lockedCancel = await findLockedSessions(
    [sessionId],
    new Map([[sessionId, session.status]]),
  );
  const cancelReason = lockedCancel.get(sessionId);
  if (cancelReason) {
    return {
      ok: false,
      error: `Buổi ${cancelReason} — không thể huỷ. Sửa dữ liệu của buổi trước, hoặc dời buổi thay vì huỷ.`,
    };
  }

  // Các buổi còn lại của lớp (không tính buổi đang huỷ) để tính ngày buổi bù cuối.
  const siblings = await client.classSession.findMany({
    where: { classId: session.classId, id: { not: sessionId }, status: { not: "CANCELLED" } },
    select: { date: true },
  });
  const makeupDate = buildMakeupDate(
    siblings.map((s) => s.date),
    session.date,
  );

  const ghi = async (tx: Prisma.TransactionClient) => {
    await tx.classSession.update({
      where: { id: sessionId },
      data: { status: "CANCELLED" },
    });

    const makeup = await tx.classSession.create({
      data: {
        classId: session.classId,
        date: makeupDate,
        topic: session.topic,
        lessonId: session.lessonId,
        planId: session.planId,
        centerId: session.centerId, // FL3-02 — denormalize từ buổi gốc/lớp cho scopedDb
        status: "SCHEDULED",
        sourceWorkRequestId: opts.sourceWorkRequestId ?? null,
      },
      select: { id: true },
    });

    await writeAudit({
      actor: { id: actorId, name: actorName },
      module: "classes",
      entityType: "ClassSession",
      entityId: sessionId,
      action: "CANCEL_SESSION",
      oldValues: { status: session.status, date: session.date },
      newValues: { status: "CANCELLED", makeupSessionId: makeup.id, makeupDate },
      reason,
      tx,
    });

    await publishEvent(
      "class.session_changed",
      {
        classId: session.classId,
        sessionId,
        change: "CANCELLED",
        makeupSessionId: makeup.id,
      },
      { tx },
    );

    return { makeupSessionId: makeup.id };
  };
  const result = opts.tx ? await ghi(opts.tx) : await db.$transaction(ghi);

  return { ok: true, makeupSessionId: result.makeupSessionId };
}

/**
 * CHỈNH 1 buổi: đổi ngày (+ giáo viên/phòng). Buổi COMPLETED → khoá.
 * ⚠️ Schema: ClassSession có cột `roomId` (W2-4b) nhưng KHÔNG có cột teacherId.
 * → date + roomId được ghi thẳng vào buổi; teacherId vẫn ghi AuditLog làm yêu cầu
 *   thay-thế GV cấp buổi (substitute) cho tới khi có cột riêng (ngoài scope).
 */
export async function adjustSession(opts: {
  sessionId: string;
  date?: Date;
  teacherId?: string | null;
  roomId?: string | null;
  actorId: string | null;
  actorName: string;
  tx?: Prisma.TransactionClient;
}): Promise<{ ok: boolean; error?: string; canhBao?: string }> {
  const { sessionId, date, teacherId, roomId, actorId, actorName } = opts;
  const client = opts.tx ?? db;

  const session = await client.classSession.findUnique({
    where: { id: sessionId },
    select: {
      id: true,
      classId: true,
      date: true,
      status: true,
      roomId: true,
      actualRoomId: true,
      actualTeacherId: true,
      substituteRoomId: true,
      substituteTeacherId: true,
    },
  });
  if (!session) return { ok: false, error: "Buổi học không tồn tại" };
  if (session.status === "COMPLETED") {
    return { ok: false, error: "Buổi đã hoàn thành — không thể chỉnh" };
  }

  const hasDate = date !== undefined;
  const hasTeacher = teacherId !== undefined;
  const hasRoom = roomId !== undefined;
  if (!hasDate && !hasTeacher && !hasRoom) {
    return { ok: false, error: "Không có thay đổi nào" };
  }

  // 19/08 — DỜI NGÀY một buổi đã được dùng là VIẾT LẠI LỊCH SỬ: điểm danh ngày 05/08 bỗng
  // hiện thành 12/08, phiếu nhận xét và ảnh lớp đi theo. Màn đổi lịch theo giai đoạn đã
  // chặn bằng findLockedSessions từ lâu, riêng đường "Điều chỉnh" từng buổi thì quên.
  // Chỉ chặn khi ĐỔI NGÀY — đổi GV dạy thay / phòng vẫn cho, đó là ghi nhận thực tế.
  if (hasDate && date.getTime() !== session.date.getTime()) {
    const locked = await findLockedSessions(
      [sessionId],
      new Map([[sessionId, session.status]]),
    );
    const reason = locked.get(sessionId);
    if (reason) {
      return { ok: false, error: `Buổi ${reason} — không thể dời ngày.` };
    }
  }

  // W2-4 (LMS-6) / T4.2 — chặn đổi buổi gây trùng GV/phòng với LỚP KHÁC.
  // Phòng/GV hiệu lực TRƯỚC và SAU thao tác tính bằng CÙNG luật với buổi đối chiếu
  // (`rowsToSlots`: substitute ?? actual ?? cấp buổi ?? lớp). Chỉ CHẶN vì thứ thao tác này
  // làm đổi (09/10/2026 — duyệt "Dạy thay" từng bị chặn vì trùng phòng CÓ SẴN của buổi;
  // xem `phamViKiemTrung`). Thiếu dữ liệu (lớp chưa có startTime) → KHÔNG chặn.
  const cls = await client.class.findUnique({
    where: { id: session.classId },
    select: { teacherId: true, roomId: true, startTime: true, endTime: true },
  });
  let canhBao: string | undefined;
  if (cls?.startTime) {
    const [truoc] = rowsToSlots([{ ...session, class: cls }]);
    const [sau] = rowsToSlots([
      {
        ...session,
        roomId: hasRoom ? roomId ?? null : session.roomId,
        substituteTeacherId: hasTeacher ? teacherId ?? null : session.substituteTeacherId,
        class: cls,
      },
    ]);
    const candDate = hasDate ? date! : session.date;
    // Mốc đầu PHẢI áp giờ lớp. Bản cũ truyền `candDate` thô (thường 00:00 vì ô chọn
    // ngày không kèm giờ) trong khi mốc cuối lại áp giờ ⇒ khung kéo dài bất thường
    // (vd 00:00 → 19:30) và đè lên mọi buổi khác trong ngày. Cùng họ lỗi với
    // sessionWindow — xem ghi chú ở lib/lms/schedule-conflict.ts.
    const khung = sessionWindow(candDate, cls.startTime, cls.endTime);
    const kq = await kiemTrungThaoTacBuoi({
      sessionId,
      classId: session.classId,
      truoc: { roomId: truoc!.roomId ?? null, teacherId: truoc!.teacherId ?? null },
      sau: { roomId: sau!.roomId ?? null, teacherId: sau!.teacherId ?? null },
      doiGio: hasDate && date.getTime() !== session.date.getTime(),
      startAt: khung.startAt,
      endAt: khung.endAt,
    });
    if (kq.loi) return { ok: false, error: kq.loi };
    canhBao = kq.canhBao ?? undefined;
  }

  const oldValues: Record<string, unknown> = { date: session.date };
  const newValues: Record<string, unknown> = {};
  if (hasDate) newValues.date = date;
  // teacherId (P4b reconcile): GV dạy-thay cấp buổi nay PERSIST vào cột
  // ClassSession.substituteTeacherId (cột đã có ở FixLMS lineage), không chỉ audit.
  // GV hiệu lực cho conflict detection ở trên đã xét substitute. null = trả về GV lớp.
  if (hasTeacher) newValues.substituteTeacherId = teacherId;
  // roomId (W2-4b): có cột cấp buổi → ghi thẳng vào ClassSession.roomId.
  if (hasRoom) {
    oldValues.roomId = session.roomId;
    newValues.roomId = roomId ?? null;
  }

  const ghi = async (tx: Prisma.TransactionClient) => {
    if (hasDate || hasRoom || hasTeacher) {
      await tx.classSession.update({
        where: { id: sessionId },
        data: {
          ...(hasDate ? { date: date! } : {}),
          ...(hasRoom ? { roomId: roomId ?? null } : {}),
          ...(hasTeacher ? { substituteTeacherId: teacherId ?? null } : {}),
        },
      });
    }

    await writeAudit({
      actor: { id: actorId, name: actorName },
      module: "classes",
      entityType: "ClassSession",
      entityId: sessionId,
      action: "ADJUST_SESSION",
      oldValues,
      newValues,
      tx,
    });

    await publishEvent(
      "class.session_changed",
      {
        classId: session.classId,
        sessionId,
        change: "ADJUSTED",
        fields: Object.keys(newValues),
      },
      { tx },
    );
  };
  if (opts.tx) await ghi(opts.tx);
  else await db.$transaction(ghi);

  return { ok: true, ...(canhBao ? { canhBao } : {}) };
}
