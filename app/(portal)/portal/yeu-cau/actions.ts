"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { portalDb, portalTx } from "@/lib/portal/db";
import { rateLimit } from "@/lib/rate-limit";
import {
  requireActiveStudent,
  assertOwnsStudent,
  getChildren,
} from "@/lib/portal/session";
import { publishEvent } from "@/lib/events/publish";

// Chống spam: trần số yêu cầu ĐANG PENDING / tài khoản phụ huynh (CANCELLED/
// APPROVED/REJECTED không tính) — tránh ngập hàng đợi /admin/parent-requests.
const MAX_PENDING_REQUESTS = 10;

// =============================================================================
// PORTAL PARENT REQUESTS — Phase NHÓM 3
// Phụ huynh gửi yêu cầu cho con đang chọn (activeSite) + tự huỷ khi còn PENDING.
// =============================================================================

const createSchema = z.object({
  type: z.enum([
    "ABSENCE",
    "MAKEUP",
    "TRANSFER_CLASS",
    "TRANSFER_CENTER",
    "RESERVE",
    "OTHER",
  ]),
  content: z.string().trim().min(5, "Vui lòng mô tả chi tiết hơn").max(2000),
  preferredDate: z.string().optional().nullable(),
  sessionId: z.string().optional().nullable(),
  /** Học bù đời mới (29/09/2026): đơn xin bù gửi từ nút của MỘT buổi vắng ⇒ gắn đúng buổi đó. */
  makeupNeedId: z.string().optional().nullable(),
});

export async function createParentRequest(input: {
  type: string;
  content: string;
  preferredDate?: string | null;
  sessionId?: string | null;
  makeupNeedId?: string | null;
}): Promise<{ ok: boolean; error?: string }> {
  const { ctx, studentId } = await requireActiveStudent();
  const pdb = portalDb({
    parentUserId: ctx.parentUserId,
    childIds: ctx.children.map((c) => c.id),
  });

  const parsed = createSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ",
    };
  }
  const d = parsed.data;

  // Chốt server-side chống spam (không tin client):
  // 1) Trần yêu cầu PENDING — chỉ đếm PENDING, yêu cầu đã huỷ/duyệt không tính.
  const pendingCount = await pdb.parentRequest.count({
    where: { parentUserId: ctx.parentUserId, status: "PENDING" },
  });
  if (pendingCount >= MAX_PENDING_REQUESTS) {
    return {
      ok: false,
      error:
        "Bạn đang có quá nhiều yêu cầu chờ xử lý. Vui lòng đợi trung tâm phản hồi hoặc huỷ bớt yêu cầu cũ trước khi gửi thêm.",
    };
  }
  // 2) Rate limit theo userId (Upstash, fallback memory) — chặn tạo dồn dập.
  const rl = await rateLimit({
    key: `parent-request:${ctx.parentUserId}`,
    max: 5,
    windowMs: 10 * 60_000,
  });
  if (!rl.success) {
    return {
      ok: false,
      error: "Bạn gửi yêu cầu quá nhanh. Vui lòng thử lại sau ít phút.",
    };
  }

  // Báo vắng: buổi phải thuộc lớp con đang học → lấy luôn ngày buổi làm preferredDate.
  // Server-side gate (không tin client): buổi SẮP TỚI, chưa bị huỷ, enrollment còn sống (FIX-C3).
  let sessionId: string | null = null;
  let sessionDate: Date | null = null;
  if (d.type === "ABSENCE" && d.sessionId) {
    const sess = await pdb.classSession.findFirst({
      where: {
        id: d.sessionId,
        date: { gte: new Date() },
        status: { not: "CANCELLED" },
        class: {
          enrollments: {
            some: {
              studentId,
              status: { in: ["CONFIRMED", "STUDYING", "ACTIVE"] },
              deletedAt: null,
            },
          },
        },
      },
      select: { id: true, date: true },
    });
    if (!sess) return { ok: false, error: "Buổi học không hợp lệ" };
    sessionId = sess.id;
    sessionDate = sess.date;
  }

  // Xin học bù cho MỘT buổi vắng: nhận id nhu cầu bù (không nhận sessionId thô từ client),
  // tra qua portalDb ⇒ chỉ nhu cầu của CON MÌNH mới khớp. Gắn buổi vắng vào đơn để màn
  // /admin/hoc-bu hiện "PH xin bù buổi này" đúng dòng (docs/hoc-bu/DAC-TA.md).
  if (d.type === "MAKEUP" && d.makeupNeedId) {
    const need = await pdb.makeupNeed.findFirst({
      where: { id: d.makeupNeedId, studentId },
      select: { missedSessionId: true },
    });
    if (!need) return { ok: false, error: "Buổi cần bù không hợp lệ" };
    sessionId = need.missedSessionId;
  }

  const preferredDate =
    sessionDate ??
    (d.preferredDate && !Number.isNaN(new Date(d.preferredDate).getTime())
      ? new Date(d.preferredDate)
      : null);

  // Tạo yêu cầu + phát DomainEvent CÙNG transaction (outbox atomic): rollback nghiệp vụ
  // → không có event; commit → dispatcher báo Sale/QL cơ sở (#08 L8.2). dedupeKey theo
  // requestId → replay/tick lặp không nhân đôi thông báo.
  await portalTx(async (tx) => {
    const req = await tx.parentRequest.create({
      data: {
        studentId,
        parentUserId: ctx.parentUserId,
        type: d.type,
        content: d.content,
        preferredDate,
        sessionId,
        status: "PENDING",
      },
      select: { id: true },
    });
    await publishEvent(
      "parent_request.created",
      {
        requestId: req.id,
        studentId,
        centerId: ctx.activeStudent?.centerId ?? null,
        type: d.type,
        parentUserId: ctx.parentUserId,
      },
      { tx, dedupeKey: `parent_request.created:${req.id}` },
    );
  });

  revalidatePath("/portal/yeu-cau");
  // Route group (admin) không xuất hiện trong URL — path thật là /admin/parent-requests.
  revalidatePath("/admin/parent-requests");
  revalidatePath("/admin/parent-requests/bao-vang");
  return { ok: true };
}

export async function cancelParentRequest(
  id: unknown,
): Promise<{ ok: boolean; error?: string }> {
  const session = await auth();
  if (!session?.user || session.user.role !== "PARENT") {
    return { ok: false, error: "Chưa đăng nhập" };
  }

  // Payload Server Action do client deserialize → validate runtime, không tin annotation.
  const parsedId = z.string().min(1).safeParse(id);
  if (!parsedId.success) return { ok: false, error: "Dữ liệu không hợp lệ" };
  const requestId = parsedId.data;

  // childIds thật từ getChildren (React.cache) → pdb hậu-kiểm ownership ở tầng query
  // (belt); assertOwnsStudent bên dưới vẫn là guard chính. Record của nhà khác → null
  // → gộp vào nhánh "Không tìm thấy yêu cầu" (an toàn hơn, không lộ tồn tại).
  const children = await getChildren(session.user.id);
  const pdb = portalDb({
    parentUserId: session.user.id,
    childIds: children.map((c) => c.id),
  });
  const req = await pdb.parentRequest.findUnique({
    where: { id: requestId },
    select: { studentId: true },
  });
  if (!req) return { ok: false, error: "Không tìm thấy yêu cầu" };
  if (!(await assertOwnsStudent(req.studentId))) {
    return { ok: false, error: "Không có quyền" };
  }

  // Atomic check-and-update: chỉ huỷ khi CÒN PENDING — tránh race ghi đè
  // APPROVED/REJECTED (admin xử lý giữa lúc đọc và ghi) thành CANCELLED.
  // updateMany là WRITE → portalDb pass-through; where giữ nguyên (atomic check-and-update).
  const updated = await pdb.parentRequest.updateMany({
    where: { id: requestId, status: "PENDING" },
    data: { status: "CANCELLED" },
  });
  if (updated.count === 0) {
    return { ok: false, error: "Chỉ huỷ được yêu cầu đang chờ xử lý" };
  }

  revalidatePath("/portal/yeu-cau");
  revalidatePath("/admin/parent-requests");
  revalidatePath("/admin/parent-requests/bao-vang");
  return { ok: true };
}
