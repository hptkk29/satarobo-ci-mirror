// lib/students/reserve-service.ts — R6-E3: duyệt ParentRequest RESERVE → bảo lưu atomic.
// Thời hạn bảo lưu ≤ setting `enrollment.suspendMaxMonths` (T3). Duyệt = 1 transaction:
// tạo StudentReserve + student PAUSED + enrollment(s) PAUSED + request APPROVED + audit (T1/T9).
// suspendedUntil mô hình hóa qua StudentReserve.expectedEndAt (đã có, không nhân đôi field).
import { db } from "@/lib/db";
import type { Actor } from "@/lib/auth/actor";
import { writeAudit } from "@/lib/audit/audit-log";
import { getSetting } from "@/lib/settings/service";
import { apDungDoiHanBaoLuu } from "@/lib/finance/bao-luu-tien";

export type ReserveResult =
  | { ok: true; reserveId: string }
  | { ok: false; error: { code: string; message: string; field?: string } };

function fail(code: string, message: string, field?: string): ReserveResult {
  return { ok: false, error: { code, message, field } };
}

/** THUẦN — số tháng giữa 2 mốc (làm tròn lên theo ngày/30 cho biên). */
export function monthsBetween(from: Date, to: Date): number {
  const ms = to.getTime() - from.getTime();
  if (ms <= 0) return 0;
  return ms / (1000 * 60 * 60 * 24 * 30);
}

/** THUẦN — thời hạn bảo lưu hợp lệ (≤ maxMonths). expectedEndAt bắt buộc (T3). */
export function validateReserveDuration(
  startedAt: Date,
  expectedEndAt: Date | null,
  maxMonths: number,
): { ok: true } | { ok: false; code: string; message: string } {
  if (!expectedEndAt) {
    return { ok: false, code: "VALIDATION", message: "Cần ngày dự kiến quay lại" };
  }
  if (expectedEndAt <= startedAt) {
    return { ok: false, code: "VALIDATION", message: "Ngày quay lại phải sau ngày bắt đầu" };
  }
  if (monthsBetween(startedAt, expectedEndAt) > maxMonths + 1e-9) {
    return {
      ok: false,
      code: "RESERVE_TOO_LONG",
      message: `Bảo lưu tối đa ${maxMonths} tháng.`,
    };
  }
  return { ok: true };
}

/** Một lượt bảo lưu quá hạn (đã quá `expectedEndAt` nhưng chưa kết thúc). */
export type ExpiredReserve = {
  id: string;
  studentId: string;
  studentName: string;
  centerId: string | null;
  expectedEndAt: Date;
  createdByUserId: string | null;
};

/**
 * THUẦN-ish (read-only) — các lượt bảo lưu CÒN HIỆU LỰC nhưng đã quá hạn dự kiến:
 *   isActive=true (chưa resume/chưa kết thúc, endedAt=null) + expectedEndAt < now.
 * Dùng cho cron cảnh báo nhân sự phụ trách. KHÔNG tự resume — chỉ liệt kê.
 */
export async function findExpiredReserves(now: Date): Promise<ExpiredReserve[]> {
  const rows = await db.studentReserve.findMany({
    where: {
      isActive: true,
      endedAt: null,
      expectedEndAt: { not: null, lt: now },
    },
    select: {
      id: true,
      studentId: true,
      expectedEndAt: true,
      createdByUserId: true,
      student: { select: { name: true, centerId: true } },
    },
    take: 1000,
  });
  return rows.map((r) => ({
    id: r.id,
    studentId: r.studentId,
    studentName: r.student.name,
    centerId: r.student.centerId,
    expectedEndAt: r.expectedEndAt!,
    createdByUserId: r.createdByUserId,
  }));
}

/**
 * Duyệt 1 ParentRequest type RESERVE → bảo lưu học viên (atomic).
 * - request phải PENDING + type RESERVE.
 * - thời hạn ≤ setting enrollment.suspendMaxMonths (theo cơ sở học viên nếu có).
 */
export async function approveReserveRequest(
  actor: Actor,
  params: {
    requestId: string;
    expectedEndAt: Date;
    startedAt?: Date;
    actorName: string;
    responseNote?: string;
  },
): Promise<ReserveResult> {
  const req = await db.parentRequest.findUnique({
    where: { id: params.requestId },
    include: { student: { select: { id: true, status: true, centerId: true } } },
  });
  if (!req) return fail("NOT_FOUND", "Không tìm thấy yêu cầu");
  if (req.type !== "RESERVE") return fail("VALIDATION", "Yêu cầu không phải loại bảo lưu");
  if (req.status !== "PENDING") return fail("CONFLICT", "Yêu cầu đã được xử lý");

  const existing = await db.studentReserve.findFirst({
    where: { studentId: req.studentId, isActive: true },
    select: { id: true },
  });
  if (existing) return fail("CONFLICT", "Học viên đang có lượt bảo lưu hiệu lực");

  const startedAt = params.startedAt ?? new Date();
  // OrgUnit của cơ sở học viên (để lấy override setting theo cơ sở nếu có).
  const orgUnitId = req.student.centerId
    ? (await db.orgUnit.findFirst({ where: { centerId: req.student.centerId }, select: { id: true } }))?.id ?? null
    : null;
  const maxMonths = await getSetting("enrollment.suspendMaxMonths", { orgUnitId });

  const v = validateReserveDuration(startedAt, params.expectedEndAt, maxMonths);
  if (!v.ok) return fail(v.code, v.message);

  const reserveId = await db.$transaction(async (tx) => {
    const reserve = await tx.studentReserve.create({
      data: {
        studentId: req.studentId,
        reason: req.content,
        startedAt,
        expectedEndAt: params.expectedEndAt,
        createdByUserId: actor.userId,
        createdByName: params.actorName,
        isActive: true,
      },
      select: { id: true },
    });

    if (req.student.status === "ACTIVE") {
      await tx.student.update({ where: { id: req.studentId }, data: { status: "PAUSED" } });
    }
    // enrollment STUDYING → PAUSED (suspendedUntil = expectedEndAt qua reserve).
    await tx.enrollment.updateMany({
      where: { studentId: req.studentId, status: "STUDYING" },
      data: { status: "PAUSED" },
    });

    await tx.parentRequest.update({
      where: { id: req.id },
      data: {
        status: "APPROVED",
        handledById: actor.userId,
        handledByName: params.actorName,
        handledAt: new Date(),
        response: params.responseNote ?? null,
      },
    });

    await writeAudit({
      actor: { id: actor.userId, name: params.actorName },
      module: "students",
      entityType: "StudentReserve",
      entityId: reserve.id,
      action: "CREATE",
      newValues: {
        studentId: req.studentId,
        expectedEndAt: params.expectedEndAt.toISOString(),
        fromRequestId: req.id,
      },
      reason: req.content,
      orgUnitId,
      tx,
    });
    return reserve.id;
  });

  // F2 · US-18 AC2 — phần TIỀN: dời hạn các đợt CHƯA TỚI HẠN của con vừa bảo lưu.
  //
  // ⚠️ Cửa bảo lưu thứ HAI. Nối ở CẢ HAI cửa, không chỉ màn quản trị: yêu cầu bảo lưu do
  // phụ huynh gửi rồi được duyệt cũng là một lượt bảo lưu thật, và bỏ cửa này là đúng con
  // đó bị báo quá hạn trong lúc đang nghỉ — ca mà AC2 sinh ra để chặn.
  //
  // Ngoài transaction (khoá đơn phải do `ghiTienChoDon` giữ) và KHÔNG ném: duyệt yêu cầu là
  // việc học vụ đã xong. `apDungDoiHanBaoLuu` an toàn khi gọi lại, nên lượt hỏng vá được.
  try {
    const tien = await apDungDoiHanBaoLuu({
      reserveId,
      actor: { id: actor.userId, name: params.actorName },
    });
    if (!tien.ok) console.error("[bao-luu] dời hạn đợt bị từ chối:", tien.error);
  } catch (err) {
    console.error("[bao-luu] dời hạn đợt thất bại:", err);
  }

  return { ok: true, reserveId };
}
