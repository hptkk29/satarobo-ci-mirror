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
import { kiemDongChoYeuCau } from "@/lib/portal/yeu-cau-bu";
import { rutDonXinNghiDaTiepNhan } from "@/lib/hoc-bu/rut-don-nghi";
import { parseVnDateTimeLocal, parseVnYmd } from "@/lib/time/vn";

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

  // Xin học bù cho MỘT buổi vắng: nhận id nhu cầu bù (không nhận sessionId thô từ client), tra qua portalDb ⇒ chỉ nhu cầu của CON MÌNH mới khớp.
  // T11: đơn gắn ĐÚNG dòng cần bù (`makeupNeedId`), chỉ khi dòng còn CHỜ XẾP và chưa có đơn mở cho nó — xem `kiemDongChoYeuCau`.
  let makeupNeedId: string | null = null;
  if (d.type === "MAKEUP" && d.makeupNeedId) {
    const kiem = await kiemDongChoYeuCau(pdb, { studentId, needId: d.makeupNeedId });
    if (!kiem.ok) return { ok: false, error: kiem.error };
    sessionId = kiem.sessionId;
    makeupNeedId = d.makeupNeedId;
  }

  // Ngày (+ GIỜ) phụ huynh đề xuất: `<input type="date">` gửi "YYYY-MM-DD", popup học bù gửi thêm giờ "YYYY-MM-DDTHH:mm".
  // Đọc theo ĐỒNG HỒ VN (lib/time/vn.ts) — `new Date("YYYY-MM-DDTHH:mm")` trên máy chủ UTC lệch 7 tiếng.
  const preferredDate =
    sessionDate ?? (d.preferredDate ? (parseVnYmd(d.preferredDate) ?? parseVnDateTimeLocal(d.preferredDate)) : null);
  // Xin học bù (13/11/2026): phụ huynh TỰ ĐỀ XUẤT ngày + giờ (không còn khung giờ cố định) ⇒ phải đọc được và không nằm trong quá khứ — nếu không, Sale nhận một đề xuất rỗng.
  if (d.type === "MAKEUP" && d.makeupNeedId) {
    if (!preferredDate) return { ok: false, error: "Ba mẹ chọn giúp ngày và giờ mong muốn nhé." };
    if (preferredDate.getTime() < Date.now() - 60_000) return { ok: false, error: "Thời gian đề xuất đã qua — ba mẹ chọn một thời điểm sắp tới nhé." };
  }

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
        makeupNeedId,
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
    select: { studentId: true, type: true, status: true },
  });
  if (!req) return { ok: false, error: "Không tìm thấy yêu cầu" };
  if (!(await assertOwnsStudent(req.studentId))) {
    return { ok: false, error: "Không có quyền" };
  }

  // 13/11/2026 — đơn xin nghỉ ĐÃ ĐƯỢC TIẾP NHẬN (trung tâm đã ghi buổi đó vắng có phép) vẫn RÚT được khi buổi chưa diễn ra: gỡ điểm danh vắng có phép, thu hồi dòng cần bù
  // chưa xếp, đơn đóng. Mọi cổng nằm trong `rutDonXinNghiDaTiepNhan` (một giao dịch). Các loại khác / đơn còn chờ đi đường cũ bên dưới.
  if (req.type === "ABSENCE" && req.status === "APPROVED") {
    const kq = await rutDonXinNghiDaTiepNhan({ requestId, studentId: req.studentId });
    if (!kq.ok) return { ok: false, error: kq.error };
    revalidatePath("/portal/yeu-cau");
    revalidatePath("/portal");
    revalidatePath("/admin/parent-requests");
    revalidatePath("/admin/attendance");
    revalidatePath("/admin/hoc-bu");
    return { ok: true };
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
