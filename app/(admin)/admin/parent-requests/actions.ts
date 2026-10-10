"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { checkPermission } from "@/lib/auth/check-permission";
import { getAuditActor } from "@/lib/audit/log";
import { createMakeupNeed } from "@/lib/makeup/service";
import { resolveActor } from "@/lib/auth/actor";
import { scopedDb, passesScope } from "@/lib/db-scope";

// Cách ly cơ sở (chống IDOR ghi): ParentRequest relation-scoped qua student.centerId.
// Duyệt/xử lý theo requestId từ client phải xác minh HV thuộc tầm nhìn actor.
async function requestStudentInScope(
  userId: string | undefined,
  student: { centerId: string | null } | null,
): Promise<boolean> {
  if (!userId || !student) return false;
  const actor = await resolveActor(userId);
  return passesScope("Student", { centerId: student.centerId }, actor);
}

// =============================================================================
// ADMIN PARENT REQUESTS — Phase NHÓM 3
// Duyệt / từ chối yêu cầu phụ huynh. KHÔNG tự động thực thi nghiệp vụ (chuyển
// lớp/bảo lưu) — staff xử lý thủ công ở module tương ứng rồi đánh dấu APPROVED.
// =============================================================================

const handleSchema = z.object({
  id: z.string().min(1),
  decision: z.enum(["APPROVED", "REJECTED"]),
  response: z.string().trim().max(2000).optional().nullable(),
});

export async function handleParentRequest(input: {
  id: string;
  decision: "APPROVED" | "REJECTED";
  response?: string | null;
}): Promise<{ ok: boolean; error?: string }> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: "Chưa đăng nhập" };
  if (!(await checkPermission("parent-requests:manage"))) {
    return { ok: false, error: "Không có quyền" };
  }

  const parsed = handleSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" };
  }

  // ParentRequest ∉ SCOPED_MODELS → sdb pass-through; cách ly qua requestStudentInScope.
  const sdb = scopedDb(await resolveActor(session.user.id));
  const req = await sdb.parentRequest.findUnique({
    where: { id: parsed.data.id },
    select: { status: true, student: { select: { centerId: true } } },
  });
  if (!req) return { ok: false, error: "Không tìm thấy yêu cầu" };
  // Cách ly cơ sở: HV của yêu cầu phải thuộc tầm nhìn actor (chống IDOR).
  if (!(await requestStudentInScope(session.user.id, req.student))) {
    return { ok: false, error: "Không tìm thấy yêu cầu" };
  }
  if (req.status !== "PENDING") {
    return { ok: false, error: "Yêu cầu đã được xử lý" };
  }

  const { actorId, actorName } = getAuditActor(session);
  await sdb.parentRequest.update({
    where: { id: parsed.data.id },
    data: {
      status: parsed.data.decision,
      response: parsed.data.response?.trim() || null,
      handledById: actorId,
      handledByName: actorName,
      handledAt: new Date(),
    },
  });

  // Route group (admin) không xuất hiện trong URL — path thật là /admin/parent-requests.
  revalidatePath("/admin/parent-requests");
  revalidatePath("/portal/yeu-cau");
  return { ok: true };
}

// =============================================================================
// RESOLVE ABSENCE — xử lý báo vắng (gộp từ /parent-requests/bao-vang)
//   (a) "Xếp học bù"  → Attendance EXCUSED + makeupStatus NEEDS_MAKEUP
//   (b) "Đánh vắng"   → Attendance ABSENT/EXCUSED + makeupStatus NONE
// Cả hai đều ghi absenceReason từ nội dung báo + duyệt yêu cầu (APPROVED).
// =============================================================================

export async function resolveAbsence(input: {
  requestId: string;
  action: "MAKEUP" | "ABSENT";
  excused?: boolean; // chỉ dùng cho ABSENT (true = có phép)
  response?: string | null;
}): Promise<{ ok: boolean; error?: string }> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: "Chưa đăng nhập" };
  if (!(await checkPermission("parent-requests:manage"))) {
    return { ok: false, error: "Không có quyền" };
  }

  const sdb = scopedDb(await resolveActor(session.user.id));
  const req = await sdb.parentRequest.findUnique({
    where: { id: input.requestId },
    select: {
      id: true, type: true, status: true, studentId: true, sessionId: true, content: true,
      student: { select: { centerId: true } },
    },
  });
  if (!req) return { ok: false, error: "Không tìm thấy yêu cầu" };
  // Cách ly cơ sở: HV của yêu cầu phải thuộc tầm nhìn actor (chống IDOR ghi attendance liên cơ sở).
  if (!(await requestStudentInScope(session.user.id, req.student))) {
    return { ok: false, error: "Không tìm thấy yêu cầu" };
  }
  if (req.type !== "ABSENCE") return { ok: false, error: "Không phải yêu cầu báo vắng" };
  if (req.status !== "PENDING") return { ok: false, error: "Yêu cầu đã được xử lý" };
  if (!req.sessionId) {
    return { ok: false, error: "Yêu cầu không gắn buổi học cụ thể — xử lý thủ công" };
  }

  const status = input.action === "MAKEUP" ? "EXCUSED" : input.excused ? "EXCUSED" : "ABSENT";
  const makeupStatus = input.action === "MAKEUP" ? "NEEDS_MAKEUP" : "NONE";
  const absenceReason = req.content.slice(0, 1000);
  const { actorId, actorName } = getAuditActor(session);

  try {
    await sdb.$transaction([
      sdb.attendance.upsert({
        where: { sessionId_studentId: { sessionId: req.sessionId, studentId: req.studentId } },
        create: {
          sessionId: req.sessionId,
          studentId: req.studentId,
          status,
          makeupStatus,
          absenceReason,
          // #04 prep: denormalize centerId (từ cơ sở HV) để record mới không null → sẵn sàng flip SCOPED.
          centerId: req.student?.centerId ?? null,
        },
        update: { status, makeupStatus, absenceReason },
      }),
      sdb.parentRequest.update({
        where: { id: req.id },
        data: {
          status: "APPROVED",
          response:
            input.response?.trim() ||
            (input.action === "MAKEUP" ? "Đã xếp học bù." : "Đã ghi nhận vắng."),
          handledById: actorId,
          handledByName: actorName,
          handledAt: new Date(),
        },
      }),
    ]);
  } catch (err) {
    console.error("[resolveAbsence]", err);
    return { ok: false, error: "Lỗi cơ sở dữ liệu" };
  }

  // "Xếp học bù" → tạo MakeupNeed PENDING gắn buổi đã lỡ.
  if (input.action === "MAKEUP") {
    await createMakeupNeed({
      studentId: req.studentId,
      missedSessionId: req.sessionId,
      createdById: actorId,
      note: absenceReason,
    }).catch(() => {});
  }

  // Route group (admin) không xuất hiện trong URL — path thật có prefix /admin.
  revalidatePath("/admin/parent-requests/bao-vang");
  revalidatePath("/admin/parent-requests");
  revalidatePath("/admin/attendance");
  revalidatePath("/admin/hoc-bu");
  revalidatePath("/portal/yeu-cau");
  return { ok: true };
}
