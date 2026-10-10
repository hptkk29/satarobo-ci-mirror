"use server";

import { auth } from "@/lib/auth";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { parseVnDateTimeLocal } from "@/lib/time/vn";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { checkPermission } from "@/lib/auth/check-permission";
import { resolveActor, type Actor } from "@/lib/auth/actor";
import { passesScope, scopedDb } from "@/lib/db-scope";
import { kiemTrungThaoTacBuoi, rowsToSlots, sessionWindow } from "@/lib/lms/schedule-conflict";
import { LoiLichLop, dauSuaTay, dichLoiTrungBuoi, khoaLopBuoi, themBuoi } from "@/lib/classes/buoi-ghi";

type ActionResult = { error?: string };
type Sdb = ReturnType<typeof scopedDb>;

// Cách ly cơ sở (chống IDOR ghi): buổi học thuộc lớp `classId` — lớp phải nằm trong
// tầm nhìn cơ sở actor (CS1 không tạo/sửa/xoá buổi của lớp CS2). passesScope("Class")
// tự cho SUPER_ADMIN/HO qua. Reconcile: main `sessions:edit` trước CHỈ gate quyền,
// không scope cơ sở → port guard từ FixLMS. Học bù liên cơ sở KHÔNG đi qua các
// action này (MAKEUP_EXCEPTION xử lý trong lib/makeup) — không nới thêm ở đây.
async function classInScope(sdb: Sdb, actor: Actor, classId: string): Promise<boolean> {
  const cls = await sdb.class.findUnique({ where: { id: classId }, select: { centerId: true } });
  return !!cls && passesScope("Class", { centerId: cls.centerId }, actor);
}

async function sessionClassInScope(
  sdb: Sdb,
  actor: Actor,
  sessionId: string,
): Promise<boolean> {
  // ⚠️ ClassSession ∈ SCOPED_MODELS: findUnique lọc hậu kỳ theo record.centerId →
  // select PHẢI kèm centerId (thiếu → ẩn nhầm buổi hợp lệ với actor center-scope).
  const s = await sdb.classSession.findUnique({
    where: { id: sessionId },
    select: { centerId: true, class: { select: { centerId: true } } },
  });
  return !!s && passesScope("Class", { centerId: s.class?.centerId ?? null }, actor);
}

/**
 * W2-4 (LMS-6) / T4.2 — soát trùng GV/phòng cho 1 buổi (tạo/sửa). Trả message VI nếu
 * trùng; null nếu không trùng / thiếu dữ liệu (lớp không tồn tại hoặc chưa có
 * startTime → default an toàn KHÔNG chặn). Buổi cùng lớp đã bị loại qua `excludeClassId`.
 *
 * 09/10/2026 — luật chặn + câu báo nay ở MỘT chỗ (`kiemTrungThaoTacBuoi`), dùng chung với
 * `adjustSession`. Sửa buổi mà KHÔNG đổi ngày giờ / lớp (chỉ sửa chủ đề, ghi chú…) thì một
 * trùng phòng/GV có sẵn không còn chặn việc lưu. Phòng/GV của buổi đang có tính theo phòng
 * HIỆU LỰC của chính buổi (`rowsToSlots`), không phải phòng cấp lớp — bản cũ so phòng lớp
 * nên bỏ qua phòng riêng của buổi.
 */
async function checkSessionScheduleConflict(
  sdb: Sdb,
  classId: string,
  date: Date,
  sessionId?: string,
): Promise<string | null> {
  // ⚠️ Class ∈ SCOPED_MODELS: findUnique lọc hậu kỳ theo centerId → select kèm centerId.
  const cls = await sdb.class.findUnique({
    where: { id: classId },
    select: { centerId: true, teacherId: true, roomId: true, startTime: true, endTime: true },
  });
  if (!cls?.startTime) return null;
  // ⚠️ ClassSession ∈ SCOPED_MODELS — select kèm centerId (xem sessionClassInScope).
  const cu = sessionId
    ? await sdb.classSession.findUnique({
        where: { id: sessionId },
        select: {
          centerId: true,
          classId: true,
          date: true,
          roomId: true,
          actualRoomId: true,
          actualTeacherId: true,
          substituteRoomId: true,
          substituteTeacherId: true,
          class: { select: { roomId: true, teacherId: true, startTime: true, endTime: true } },
        },
      })
    : null;
  const [truoc] = cu ? rowsToSlots([{ id: sessionId!, ...cu }]) : [null];
  const [sau] = cu
    ? rowsToSlots([{ id: sessionId!, ...cu, date, class: cls }])
    : [{ roomId: cls.roomId, teacherId: cls.teacherId }];
  if (!sau?.roomId && !sau?.teacherId) return null;
  // Mốc đầu PHẢI áp giờ lớp — xem ghi chú ở lib/lms/schedule-conflict.ts.
  const khung = sessionWindow(date, cls.startTime, cls.endTime);
  const kq = await kiemTrungThaoTacBuoi({
    sessionId,
    classId,
    // Đổi sang lớp khác = tài nguyên của lớp mới ⇒ coi như buổi mới, kiểm hết.
    truoc:
      truoc && cu?.classId === classId
        ? { roomId: truoc.roomId ?? null, teacherId: truoc.teacherId ?? null }
        : null,
    sau: { roomId: sau.roomId ?? null, teacherId: sau.teacherId ?? null },
    doiGio: !cu || cu.date.getTime() !== date.getTime(),
    startAt: khung.startAt,
    endAt: khung.endAt,
  });
  return kq.loi;
}

const sessionSchema = z.object({
  classId: z.string().trim().min(1, "Lớp học không được để trống"),
  date: z.date({ message: "Ngày học không hợp lệ" }),
  topic: z.string().trim().optional(),
  notes: z.string().trim().optional(),
  lessonId: z.string().trim().optional(),
  lessonNotes: z.string().trim().optional(),
  // 07/09 — PHÂN LOẠI BUỔI. Rỗng = chưa phân loại ⇒ công dạy tính theo dòng mặc định
  // (`SessionCategory.isDefault`). Cố ý KHÔNG bắt buộc: form này đang được dùng hằng ngày, ép
  // một trường mới là chặn mọi đường sửa buổi cho tới khi ai đó gán đủ.
  sessionCategoryId: z.string().trim().optional(),
});

function emptyToUndefined(value: FormDataEntryValue | null): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function emptyToNull(value: string | undefined): string | null {
  return value ?? null;
}

/**
 * `<input type="datetime-local">` → `Date`, đọc theo GIỜ VIỆT NAM.
 *
 * ⚠️ 06/09/2026 — bản cũ là `new Date(value)` trần. Chuỗi `"YYYY-MM-DDTHH:mm"` KHÔNG có
 * hậu tố múi giờ nên theo chuẩn nó được hiểu là giờ ĐỊA PHƯƠNG CỦA TIẾN TRÌNH. Máy dev
 * chạy +07 nên nhìn như đúng; **Vercel chạy UTC**, nên mỗi lần giáo vụ lưu một buổi ở
 * `/admin/sessions`, mốc bị đẩy đi 7 tiếng: nhập 17:30 ngày 12/09 thì DB ghi
 * `2026-09-12T17:30:00Z` = **00:30 ngày 13/09 giờ VN**.
 *
 * Hậu quả dây chuyền: cổng phụ huynh in giờ học nửa đêm, buổi nhảy sang hôm sau và lệch
 * thứ, còn "đã diễn ra"/"buổi hôm nay" tính sai theo. Sửa mỗi lần lưu lại đẩy thêm 7 giờ
 * nữa nếu vẫn dùng hàm cũ.
 *
 * Cùng quy ước với `combineVNDateTime` (lib/attendance/adjust.ts) và màn giao bài của
 * site giáo viên: nối cứng hậu tố `+07:00`. Việt Nam không có giờ mùa hè nên offset cố định.
 */
function parseDateTimeLocal(value: FormDataEntryValue | null): Date | null {
  return typeof value === "string" ? parseVnDateTimeLocal(value) : null;
}

async function requireTeacherOrAdmin() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!(await checkPermission("sessions:edit"))) {
    redirect("/dashboard?error=unauthorized");
  }
  return session.user;
}

function readForm(formData: FormData) {
  const dateValue = parseDateTimeLocal(formData.get("date"));
  return {
    classId: emptyToUndefined(formData.get("classId")) ?? "",
    date: dateValue ?? new Date(NaN), // forces zod fail if missing
    topic: emptyToUndefined(formData.get("topic")),
    notes: emptyToUndefined(formData.get("notes")),
    lessonId: emptyToUndefined(formData.get("lessonId")),
    lessonNotes: emptyToUndefined(formData.get("lessonNotes")),
    sessionCategoryId: emptyToUndefined(formData.get("sessionCategoryId")),
  };
}

export async function createSession(formData: FormData): Promise<ActionResult> {
  const user = await requireTeacherOrAdmin();

  const parsed = sessionSchema.safeParse(readForm(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" };
  }

  const s = parsed.data;

  // Cách ly cơ sở: chỉ tạo buổi cho lớp trong tầm nhìn cơ sở actor.
  const actor = await resolveActor(user.id);
  const sdb = scopedDb(actor);
  if (!(await classInScope(sdb, actor, s.classId))) return { error: "Lớp ngoài phạm vi cơ sở" };

  // W2-4 — chặn tạo buổi gây trùng GV/phòng với lớp khác.
  const conflictMsg = await checkSessionScheduleConflict(sdb, s.classId, s.date);
  if (conflictMsg) return { error: conflictMsg };

  // FL3-02 — centerId denormalized từ class cho scopedDb (buổi học cách ly cơ sở).
  const clsCenter = await sdb.class.findUnique({
    where: { id: s.classId },
    select: { centerId: true },
  });

  const data: Prisma.ClassSessionUncheckedCreateInput = {
    classId: s.classId,
    date: s.date,
    centerId: clsCenter?.centerId ?? null,
    topic: emptyToNull(s.topic),
    notes: emptyToNull(s.notes),
    lessonNotes: emptyToNull(s.lessonNotes),
    ...(s.lessonId ? { lessonId: s.lessonId } : {}),
    ...(s.sessionCategoryId ? { sessionCategoryId: s.sessionCategoryId } : {}),
  };

  try {
    // T03: khoá lớp + từ chối buổi trùng giờ; buổi do NGƯỜI tạo tay mang dấu "chỉnh tay" để các lần áp lại lịch tự động
    // (đổi giai đoạn, ngày nghỉ…) không kéo nó đi. Trước đây `catch {}` nuốt MỌI lỗi thành một câu sai nguyên nhân.
    await sdb.$transaction(async (txRaw) => {
      await themBuoi(txRaw as unknown as Prisma.TransactionClient, data, { actorId: user.id, now: new Date() });
    });
  } catch (e) {
    const loi = dichLoiTrungBuoi(e);
    return { error: loi ? loi.message : "Không tạo được buổi học. Lớp có tồn tại không?" };
  }

  revalidatePath("/sessions");
  revalidatePath("/attendance");
  // Thành công → trả {} để client toast + điều hướng giữ bộ lọc (QA 20/07 Vấn đề C/D).
  return {};
}

export async function updateSession(id: string, formData: FormData): Promise<ActionResult> {
  const user = await requireTeacherOrAdmin();

  const parsed = sessionSchema.safeParse(readForm(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" };
  }

  const s = parsed.data;

  // Cách ly cơ sở: buổi hiện tại + lớp đích đều phải trong tầm nhìn cơ sở actor.
  const actor = await resolveActor(user.id);
  const sdb = scopedDb(actor);
  if (!(await sessionClassInScope(sdb, actor, id))) return { error: "Buổi học ngoài phạm vi cơ sở" };
  if (!(await classInScope(sdb, actor, s.classId))) return { error: "Lớp đích ngoài phạm vi cơ sở" };

  // W2-4 — chặn cập nhật buổi (đổi ngày/giờ) gây trùng GV/phòng với lớp khác.
  const conflictMsg = await checkSessionScheduleConflict(sdb, s.classId, s.date, id);
  if (conflictMsg) return { error: conflictMsg };

  const data: Prisma.ClassSessionUpdateInput = {
    class: { connect: { id: s.classId } },
    date: s.date,
    topic: emptyToNull(s.topic),
    notes: emptyToNull(s.notes),
    lessonNotes: emptyToNull(s.lessonNotes),
    lesson: s.lessonId
      ? { connect: { id: s.lessonId } }
      : { disconnect: true },
    sessionCategory: s.sessionCategoryId
      ? { connect: { id: s.sessionCategoryId } }
      : { disconnect: true },
  };

  try {
    await sdb.$transaction(async (txRaw) => {
      const tx = txRaw as unknown as Prisma.TransactionClient;
      const cu = await tx.classSession.findUnique({ where: { id }, select: { classId: true, date: true } });
      if (!cu) throw new Error("Buổi học không tồn tại");
      // T03: khoá CẢ lớp cũ lẫn lớp đích (đúng thứ tự cố định để hai lượt chéo nhau không khoá vòng), rồi đọc lại dưới khoá.
      for (const cid of [...new Set([cu.classId, s.classId])].sort()) await khoaLopBuoi(tx, cid);
      const dongBo = await tx.classSession.findUnique({ where: { id }, select: { classId: true, date: true } });
      if (!dongBo || dongBo.classId !== cu.classId) {
        throw new LoiLichLop("BUOI_DA_DOI", "Buổi vừa được người khác sửa — tải lại trang rồi làm lại.");
      }
      // Chỉ ĐỔI NGÀY hoặc CHUYỂN LỚP mới là "chỉnh tay" (và mới cần kiểm trùng giờ); sửa chủ đề/ghi chú thì không.
      const doiViTri = dongBo.date.getTime() !== s.date.getTime() || dongBo.classId !== s.classId;
      if (doiViTri) {
        const trung = await tx.classSession.findFirst({
          where: { classId: s.classId, id: { not: id }, date: s.date, status: { not: "CANCELLED" } },
          select: { id: true },
        });
        if (trung) throw new LoiLichLop("TRUNG_BUOI", "Lớp đã có một buổi học vào đúng giờ này — chọn giờ khác hoặc dời buổi kia trước.");
      }
      await tx.classSession.update({
        where: { id },
        data: { ...data, ...(doiViTri ? dauSuaTay(user.id, new Date()) : {}) },
      });
    });
  } catch (e) {
    const loi = dichLoiTrungBuoi(e);
    return { error: loi ? loi.message : "Không cập nhật được buổi học" };
  }

  revalidatePath("/sessions");
  revalidatePath(`/sessions/${id}/edit`);
  revalidatePath("/attendance");
  return {};
}

export async function deleteSession(id: string): Promise<ActionResult> {
  const user = await requireTeacherOrAdmin();
  // Cách ly cơ sở: chỉ xoá buổi của lớp trong tầm nhìn cơ sở actor.
  const actor = await resolveActor(user.id);
  const sdb = scopedDb(actor);
  if (!(await sessionClassInScope(sdb, actor, id))) return { error: "Buổi học ngoài phạm vi cơ sở" };
  try {
    // ClassSession có onDelete: Cascade trên attendances — sẽ tự xoá luôn.
    await sdb.classSession.delete({ where: { id } });
  } catch {
    return { error: "Không thể xoá buổi học" };
  }
  revalidatePath("/sessions");
  revalidatePath("/attendance");
  return {};
}
