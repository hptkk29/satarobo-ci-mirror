// _feedback-core.ts — LOGIC THẬT của phiếu nhận xét theo buổi (saveSessionFeedback /
// saveSessionEval), tách khỏi _actions.ts ("use server") vì 2 lý do:
//   1. Test được (tests/e2e/r7/session-feedback-fixes.spec.ts): runner Playwright stub
//      `@/lib/auth` → auth() = null, wrapper action không chạy được happy-path; core
//      nhận `user` tường minh nên spec gọi thẳng.
//   2. An toàn: MỌI export của file "use server" là HTTP endpoint — hàm nhận `user`
//      làm tham số KHÔNG được phép nằm trong đó (client forge user = leo quyền).
//      Caller hợp lệ DUY NHẤT: _actions.ts + PDF route (đều SAU auth()).
//
// Fix đợt rà soát nhận-xét-theo-buổi 08/2026:
//   #1 dòng comment RỖNG chỉ xoá phiếu khi phiếu KHÔNG có phần mở rộng
//      (projectName/notes/rubric); phiếu mở rộng → clear comment/rating, GIỮ rubric
//      (hết cảnh "Lưu tất cả" ở /teacher/nhan-xet nuốt phiếu rubric đã chấm).
//   #3 gate theo isSessionOwnedByTeacher — GV dạy thay (substituteTeacherId) /
//      thực dạy (actualTeacherId) nhận xét được, khớp gate điểm danh.
//   #4 email "nhận xét mới" CHỈ enqueue khi comment THỰC SỰ đổi (so old↔new đọc
//      trước khi ghi) — re-save không spam phụ huynh.
//   #5 createdById chỉ set khi CREATE — re-save không cướp tác giả phiếu.
//
// ✅ ĐÃ VÁ 06/09/2026 — nợ "hai đường ghi, hai cột" nêu bên dưới nay đã đóng.
//
// Nợ cũ: `saveSessionEvalCore` ghi `notes` (+ mirror sang `comment`), còn
// `saveSessionFeedbackCore` chỉ ghi `comment`; mọi chỗ HIỂN THỊ lại ưu tiên `notes`
// (`evalNotesProse`). Hệ quả với người dùng thật: phiếu đã có `notes` mà giáo viên sửa
// qua "nhận xét nhanh" (/teacher/nhan-xet, editor ở /admin/sessions/[id]) thì phụ huynh
// nhận EMAIL bản MỚI nhưng mở portal/PDF ra vẫn đọc bản CŨ — và lần lưu phiếu đầy đủ kế
// tiếp còn ghi đè ngược lại lời vừa sửa.
//
// Vá: nhánh nhận xét nhanh nay ghi ĐỒNG THỜI `comment` và `notes.overall` khi phiếu đã
// có `notes` (xem `capNhatNotesOverall` dưới). Phiếu chưa từng có `notes` vẫn chỉ ghi
// `comment` như cũ — không tự sinh cấu trúc `notes` cho phiếu thuần văn xuôi.
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { resolveActor } from "@/lib/auth/actor";
import { scopedDb, withMakeupException } from "@/lib/db-scope";
import { getSessionRosterStudentIds } from "@/lib/attendance/roster";
import { enqueueNewFeedback } from "@/lib/email/triggers";
import { hasRole } from "@/lib/auth/permissions";
import { getFreshGateUser } from "@/lib/auth/fresh-gate-user";
import { publishEvent } from "@/lib/events/publish";
import { isSessionOwnedByTeacher } from "@/lib/lms/session-ownership";
import { isBlankFeedbackInput } from "@/lib/lms/feedback-content";
import {
  EMPTY_NOTES,
  EVAL_OVERALL_HARD_MAX,
  EVAL_OVERALL_MAX,
  normalizeEvalNotes,
  parseFeedbackNotes,
  toOverallText,
} from "@/lib/lms/session-eval-rubric";

export type FeedbackResult = { ok: true } | { ok: false; error: string };

/** Người thao tác (wrapper đã auth()) — đúng 3 field mà gate cần. */
export type SessionGateUser = { id: string; role: string; centerId: string | null };

/** Dữ liệu buổi cần cho gate ownership (kèm cả dạy thay/thực dạy). */
export type SessionOwnershipGate = {
  classId: string;
  substituteTeacherId: string | null;
  actualTeacherId: string | null;
  class: { centerId: string | null };
};

/**
 * FIX #3 — quyền thao tác NHẬN XÉT trên 1 buổi: SUPER_ADMIN, CENTER_MANAGER cùng
 * cơ sở, hoặc GV SỞ HỮU BUỔI theo isSessionOwnedByTeacher (lớp được phân công ∪
 * dạy thay ∪ thực dạy) — khớp gate điểm danh, thay cho canManageSessionClass
 * (chỉ teacherId/assistantId của LỚP, làm GV dạy thay điểm danh được mà nhận xét không).
 */
export async function canManageSessionRecord(
  user: SessionGateUser,
  sess: SessionOwnershipGate,
): Promise<boolean> {
  // Vai + cơ sở đọc TỪ DB, không từ JWT — gỡ vai phải có tác dụng ngay, không đợi người
  // dùng đăng xuất. Xem lib/auth/fresh-gate-user.ts.
  const u = (await getFreshGateUser(user.id)) ?? user;
  if (hasRole(u, "SUPER_ADMIN")) return true;
  if (hasRole(u, "CENTER_MANAGER")) {
    return !!sess.class.centerId && sess.class.centerId === u.centerId;
  }
  if (hasRole(u, "TEACHER")) {
    const actor = await resolveActor(user.id);
    return isSessionOwnedByTeacher(
      {
        classId: sess.classId,
        substituteTeacherId: sess.substituteTeacherId,
        actualTeacherId: sess.actualTeacherId,
      },
      { userId: user.id, assignedClassIds: actor.assignedClassIds },
    );
  }
  return false;
}

const feedbackSchema = z.object({
  sessionId: z.string().min(1),
  items: z
    .array(
      z.object({
        studentId: z.string().min(1),
        comment: z.string().trim().max(3000),
        rating: z.coerce.number().int().min(1).max(5).nullable().optional(),
      }),
    )
    .max(100),
});

// Phiếu nhận xét buổi (site GV) — 1 HV/lần: Dự án + văn xuôi + rubric 9 tiêu chí.
//
// 21/08 — văn xuôi nay là MỘT ô `overall` ("Đánh giá chung", ≤ EVAL_OVERALL_MAX).
// 4 khoá cũ vẫn nhận được và vẫn để `.max(3000)`: bản ghi cũ có thể dài hơn 2000 và
// vẫn phải lưu lại được khi giáo viên mở phiếu cũ ra sửa phần rubric. MỌI khoá đều
// optional để hộp thoại mới (chỉ gửi `overall`) và mọi caller cũ cùng chạy được.
const evalNotesSchema = z.object({
  // Trần CỨNG ở đây; trần nghiệp vụ EVAL_OVERALL_MAX kiểm sau khi đọc phiếu cũ
  // (nội dung cũ dài hơn 2000 vẫn phải lưu lại được — xem EVAL_OVERALL_HARD_MAX).
  overall: z.string().trim().max(EVAL_OVERALL_HARD_MAX).optional(),
  knowledge: z.string().trim().max(3000).optional(),
  skill: z.string().trim().max(3000).optional(),
  attitude: z.string().trim().max(3000).optional(),
  proposal: z.string().trim().max(3000).optional(),
});

const sessionEvalSchema = z.object({
  sessionId: z.string().min(1),
  studentId: z.string().min(1),
  projectName: z.string().trim().max(200).nullable().optional(),
  notes: evalNotesSchema,
  // { criterionId: level 1-5 } — chấp nhận mọi key (9 tiêu chí lib/lms/session-eval-rubric).
  rubric: z.record(z.string(), z.coerce.number().int().min(1).max(5)),
});

// ⚠️ select kèm centerId — findUnique trên model scoped lọc hậu kỳ theo field này.
const SESSION_GATE_SELECT = {
  id: true,
  centerId: true,
  classId: true,
  substituteTeacherId: true,
  actualTeacherId: true,
  class: { select: { centerId: true } },
} as const;

/**
 * LMS-2 — lưu hàng loạt nhận xét nhanh (comment + sao) từng HS cho 1 buổi.
 * Core thuần (không auth()) — xem đầu file về caller hợp lệ.
 */
/**
 * Mảnh `data` để đồng bộ `notes.overall` với văn xuôi vừa gõ ở ô "nhận xét nhanh".
 *
 * Trả `{}` (không đụng cột `notes`) khi phiếu CHƯA có `notes` — phiếu thuần văn xuôi
 * không cần cấu trúc rubric, và tự sinh ra nó sẽ làm mọi chỗ đọc chuyển sang nhánh
 * "phiếu mở rộng" một cách bất ngờ (`hasExtended` ngay trong file này chẳng hạn).
 */
function capNhatNotesOverall(
  notesCu: Prisma.JsonValue | null | undefined,
  vanXuoi: string,
): { notes?: Prisma.InputJsonValue } {
  if (notesCu === null || notesCu === undefined) return {};
  const notes = normalizeEvalNotes(notesCu);
  if (notes.overall === vanXuoi) return {};
  return { notes: { ...notes, overall: vanXuoi } };
}

export async function saveSessionFeedbackCore(
  user: SessionGateUser,
  input: unknown,
): Promise<FeedbackResult> {
  const parsed = feedbackSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" };
  }
  const { sessionId, items } = parsed.data;

  // Loại B (Nhóm 01 L1) — ClassSession scoped auto; StudentSessionFeedback/Attendance
  // chưa scoped → cách ly qua buổi (sdb.findUnique IDOR-filter) + gate ownership dưới.
  const actor = await resolveActor(user.id);
  const sdb = scopedDb(actor);
  // 19/08 — nạp buổi qua withMakeupException, KHÔNG qua scopedDb thuần.
  //
  // Giáo viên là nguồn lực dùng chung: Hội sở điều một GV của CS1 sang dạy lớp ở CS2 thì
  // `actor.visibleCenterIds` vẫn chỉ có CS1, nên `sdb.classSession.findUnique` lọc mất
  // buổi và hàm này trả "Buổi học không tồn tại" — trong khi CÙNG GV đó điểm danh bình
  // thường vì đường điểm danh (teacher/lop/_actions.ts) đã đi qua withMakeupException.
  // Cách ly không bị nới: quyền sở hữu buổi vẫn do canManageSessionRecord chốt ngay dưới,
  // và CENTER_MANAGER vẫn bị so centerId đúng như cũ.
  const sess = await withMakeupException(actor).classSession.findUnique({
    where: { id: sessionId },
    select: SESSION_GATE_SELECT,
  });
  if (!sess) return { ok: false, error: "Buổi học không tồn tại" };

  const allowed = await canManageSessionRecord(user, sess);
  if (!allowed) return { ok: false, error: "Không có quyền nhận xét buổi học này" };

  // SEC-M02: mỗi studentId PHẢI thuộc roster hợp lệ của buổi (enrolled ∪ học bù SCHEDULED)
  // — chống ghi phiếu giả cho HV lớp/cơ sở khác rồi gửi thông báo tới phụ huynh họ.
  const rosterIds = await getSessionRosterStudentIds(actor, sessionId);
  if (items.some((it) => !rosterIds.has(it.studentId))) {
    return { ok: false, error: "Có học viên không thuộc danh sách buổi này" };
  }

  // FIX #1/#4/#5 — đọc phiếu hiện hữu TRƯỚC khi ghi (StudentSessionFeedback ∉
  // SCOPED_MODELS → sdb pass-through; cách ly đã chốt qua gate buổi ở trên):
  //   • biết dòng rỗng có được xoá không (phiếu mở rộng thì KHÔNG),
  //   • biết comment có thực sự đổi không (quyết định gửi email).
  const existingRows = items.length
    ? await sdb.studentSessionFeedback.findMany({
        where: { classSessionId: sessionId, studentId: { in: items.map((i) => i.studentId) } },
        select: { studentId: true, comment: true, projectName: true, notes: true, rubric: true },
      })
    : [];
  const existingBy = new Map(existingRows.map((r) => [r.studentId, r]));
  const hasExtended = (r: (typeof existingRows)[number]) =>
    r.projectName !== null || r.notes !== null || r.rubric !== null;

  const ops: Prisma.PrismaPromise<unknown>[] = [];
  // Vị trí op UPSERT của từng item (-1 = item không sinh upsert) — để map id phiếu
  // từ kết quả transaction về đúng HV khi phát event.
  const upsertOpIdxByItem = new Array<number>(items.length).fill(-1);
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    const comment = it.comment.trim();
    const rating = it.rating ?? null;
    const old = existingBy.get(it.studentId);
    // 19/08 — "dòng rỗng" phải tính CẢ SAO, không chỉ chữ. Bản cũ chỉ xét `comment` nên
    // GV chấm sao mà không gõ chữ thì: (a) chưa có phiếu → `continue`, số sao rơi vào hư
    // không nhưng hàm vẫn trả ok và màn hình vẫn toast "Đã lưu"; (b) đã có phiếu → rơi
    // xuống nhánh xoá/gỡ bên dưới, tức thao tác CHẤM SAO lại đi PHÁ phiếu đang có.
    // Cả hai đều là mất dữ liệu im lặng — đúng thứ người dùng báo là "nhập rồi mà mất".
    if (isBlankFeedbackInput(comment, rating)) {
      if (!old) continue; // chưa có phiếu — không có gì để xoá
      if (hasExtended(old)) {
        // FIX #1 — phiếu mở rộng (rubric/notes/projectName): chỉ gỡ comment/sao,
        // GIỮ NGUYÊN phần rubric GV đã chấm.
        ops.push(
          sdb.studentSessionFeedback.updateMany({
            where: { classSessionId: sessionId, studentId: it.studentId },
            data: { comment: null, rating: null },
          }),
        );
      } else {
        // Phiếu thuần comment — xoá như hành vi cũ.
        ops.push(
          sdb.studentSessionFeedback.deleteMany({
            where: { classSessionId: sessionId, studentId: it.studentId },
          }),
        );
      }
      continue;
    }
    upsertOpIdxByItem[i] = ops.length;
    ops.push(
      sdb.studentSessionFeedback.upsert({
        where: {
          classSessionId_studentId: { classSessionId: sessionId, studentId: it.studentId },
        },
        // FIX #5 — update KHÔNG ghi đè createdById (giữ tác giả phiếu gốc cho PDF/portal).
        // `comment || null`: phiếu chỉ-có-sao lưu comment NULL chứ không phải chuỗi rỗng —
        // mọi chỗ đọc đều coi null là "chưa có văn xuôi" (portal, PDF, session-eval-card).
        //
        // 06/09 — ĐỒNG BỘ `notes.overall`: phiếu đã có `notes` thì mọi màn hiển thị đọc
        // `notes` chứ không đọc `comment`, nên chỉ ghi `comment` là phụ huynh nhận email
        // bản mới mà vẫn đọc bản cũ. Xem khối chú thích đầu file.
        update: {
          comment: comment || null,
          rating,
          ...capNhatNotesOverall(old?.notes, comment),
        },
        create: {
          classSessionId: sessionId,
          studentId: it.studentId,
          comment: comment || null,
          rating,
          createdById: user.id,
        },
      }),
    );
  }

  let txResults: unknown[] = [];
  try {
    if (ops.length > 0) txResults = await sdb.$transaction(ops);
  } catch (err) {
    return { ok: false, error: `Lỗi lưu nhận xét: ${err instanceof Error ? err.message : "Unknown"}` };
  }

  // R7-17 — emit "comment.added" cho mỗi nhận xét per-HV vừa lưu → PH của HV đó
  // nhận thông báo (lib/_handlers/comment-notif.ts). Phát SAU commit: transaction
  // ở đây là dạng batch-array ($transaction([...])) — không nhận promise non-Prisma
  // (publishEvent) vào mảng nên không gắn được tx. dedupeKey theo commentId
  // (StudentSessionFeedback.id) → sửa nhận xét không tạo thông báo trùng.
  try {
    for (let i = 0; i < items.length; i++) {
      const opIdx = upsertOpIdxByItem[i];
      if (opIdx < 0) continue;
      const row = txResults[opIdx];
      const commentId =
        row && typeof row === "object" && "id" in row && typeof (row as { id: unknown }).id === "string"
          ? (row as { id: string }).id
          : null;
      if (!commentId) continue;
      await publishEvent(
        "comment.added",
        { studentId: items[i].studentId, sessionId, commentId, byUserId: user.id },
        { dedupeKey: `comment.added:${commentId}` },
      );
    }
  } catch (err) {
    console.error("[saveSessionFeedback] publish comment.added error:", err);
  }

  // A2 — đẩy email "nhận xét mới" cho phụ huynh (chỉ con liên quan, không lộ con khác).
  // FIX #4 — CHỈ dòng có comment THỰC SỰ ĐỔI so với phiếu cũ (EmailQueue không có khoá
  // dedupe, enqueue lại = PH nhận email trùng). Lưu ý: Student scoped → HV học bù đến
  // từ CƠ SỞ KHÁC bị lọc khỏi email này với actor center-scope (in-app notification
  // qua event comment.added không ảnh hưởng).
  try {
    const changed = items.filter((it, i) => {
      if (upsertOpIdxByItem[i] < 0) return false;
      const oldComment = (existingBy.get(it.studentId)?.comment ?? "").trim();
      return oldComment !== it.comment.trim();
    });
    if (changed.length > 0) {
      const [students, cls] = await Promise.all([
        sdb.student.findMany({
          where: { id: { in: changed.map((i) => i.studentId) }, parentUserId: { not: null } },
          select: { id: true, name: true, parentName: true, parentUser: { select: { email: true, name: true } } },
        }),
        sdb.classSession.findUnique({
          where: { id: sessionId },
          // ⚠️ kèm centerId — findUnique model scoped lọc hậu kỳ theo field này.
          select: { centerId: true, class: { select: { name: true } } },
        }),
      ]);
      const byId = new Map(changed.map((i) => [i.studentId, i]));
      for (const s of students) {
        const email = s.parentUser?.email;
        if (!email) continue;
        const it = byId.get(s.id);
        await enqueueNewFeedback({
          to: email,
          parentName: s.parentUser?.name ?? s.parentName,
          studentName: s.name,
          className: cls?.class.name ?? "",
          comment: it?.comment.trim() ?? "",
          rating: it?.rating ?? null,
        });
      }
    }
  } catch (err) {
    console.error("[saveSessionFeedback] enqueue email error:", err);
  }

  return { ok: true };
}

/**
 * Site GV — lưu PHIẾU nhận xét buổi học của MỘT học viên (khớp reference TeachUI
 * StudentEvalDialog). Ghi projectName/notes/rubric; comment (nullable) = gộp 4 mục
 * để badge "đã nhận xét" + portal PH + email vẫn chạy. Core thuần (không auth()).
 */
export async function saveSessionEvalCore(
  user: SessionGateUser,
  input: unknown,
  /**
   * 26/09/2026 — BẮT BUỘC truyền (luật 7: không mặc định cho tham số "gửi tin"). Màn giáo viên
   * truyền `true` (hành vi như cũ). Seed thử (`scripts/seed-thu-nhan-xet-giao-vien.ts`) truyền
   * `false`: đi đúng đường giáo viên nhập nhưng KHÔNG xếp email NEW_FEEDBACK — hàng đợi email
   * không có trạng thái huỷ, và trên env `test` cron gửi thật mỗi 5 phút. Chỉ tắt EMAIL; thông
   * báo trong cổng phụ huynh (DomainEvent `comment.added`) vẫn phát như giáo viên nhập thật.
   */
  tuyChon: { guiEmailPhuHuynh: boolean },
): Promise<FeedbackResult> {
  return luuPhieuNhanXet(user, input, tuyChon, "KIEM");
}

/**
 * HỌC BÙ (29/09/2026) — nhận xét nhập ở CASE DẠY BÙ ghi vào buổi VẮNG gốc "như nhập ở buổi
 * chính" (chủ dự án): cùng phiếu, cùng thông báo phụ huynh, cùng email. Chỉ khác CỔNG: người
 * dạy bù thường không thuộc lớp gốc nên `canManageSessionRecord` sẽ chặn — cổng thay thế
 * ("đúng GV của case" / quyền điểm danh bù) do `lib/hoc-bu/case-db.ts` kiểm TRƯỚC khi gọi.
 * Roster của buổi gốc vẫn kiểm như thường (bé vắng vẫn nằm trong roster).
 */
export async function saveSessionEvalChoHocBu(
  user: SessionGateUser,
  input: unknown,
  tuyChon: { guiEmailPhuHuynh: boolean },
): Promise<FeedbackResult> {
  return luuPhieuNhanXet(user, input, tuyChon, "DA_KIEM_O_HOC_BU");
}

async function luuPhieuNhanXet(
  user: SessionGateUser,
  input: unknown,
  tuyChon: { guiEmailPhuHuynh: boolean },
  congBuoi: "KIEM" | "DA_KIEM_O_HOC_BU",
): Promise<FeedbackResult> {
  const parsed = sessionEvalSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" };
  }
  const { sessionId, studentId, projectName, rubric } = parsed.data;
  // Ghi ĐỦ 5 khoá: hộp thoại mới chỉ gửi `overall`, và nếu để 4 khoá cũ nguyên giá trị
  // thì phiếu cũ vừa được viết lại sẽ hiển thị CẢ đoạn mới lẫn 4 mục cũ (nội dung lặp).
  const notes = { ...EMPTY_NOTES, ...parsed.data.notes };

  const actor = await resolveActor(user.id);
  const sdb = scopedDb(actor);
  // Xem ghi chú ở saveSessionFeedbackCore về withMakeupException (GV dạy lớp cơ sở khác).
  const sess = await withMakeupException(actor).classSession.findUnique({
    where: { id: sessionId },
    select: SESSION_GATE_SELECT,
  });
  if (!sess) return { ok: false, error: "Buổi học không tồn tại" };

  if (congBuoi === "KIEM") {
    const allowed = await canManageSessionRecord(user, sess);
    if (!allowed) return { ok: false, error: "Không có quyền nhận xét buổi học này" };
  }

  // SEC-M02: studentId PHẢI thuộc roster hợp lệ của buổi (enrolled ∪ học bù SCHEDULED) —
  // chống ghi phiếu giả cho HV lớp/cơ sở khác rồi gửi thông báo tới phụ huynh họ.
  const rosterIds = await getSessionRosterStudentIds(actor, sessionId);
  if (!rosterIds.has(studentId)) {
    return { ok: false, error: "Học viên không thuộc danh sách buổi này" };
  }

  // comment tương thích cũ (email PH, badge "đã nhận xét", portal đường cũ) = văn xuôi
  // của phiếu: từ 21/08 là ô "Đánh giá chung"; phiếu gửi kiểu cũ vẫn nối 4 mục như trước.
  // Rỗng hết → null, phiếu rubric-only vẫn lưu.
  const comment =
    notes.overall.trim() ||
    [notes.knowledge, notes.skill, notes.attitude, notes.proposal]
      .map((s) => s.trim())
      .filter(Boolean)
      .join("\n") ||
    null;

  // FIX #4 — đọc comment cũ trước khi ghi: re-save không đổi văn xuôi thì KHÔNG email lại.
  const old = await sdb.studentSessionFeedback.findUnique({
    where: { classSessionId_studentId: { classSessionId: sessionId, studentId } },
    select: { comment: true, notes: true },
  });
  // Phiếu CŨ (4 mục) mở ra là hộp thoại ghép sẵn thành một đoạn CÓ NHÃN, khác chuỗi
  // `comment` cũ (4 mục nối KHÔNG nhãn). Nếu chỉ so chuỗi thì mỗi lần giáo viên mở phiếu
  // cũ ra bấm Lưu — kể cả không gõ thêm chữ nào — phụ huynh lại nhận một email "nhận xét
  // mới". Nhận diện đúng ca "chỉ đổi hình thức" rồi im lặng.
  const chiChuyenDangPhieuCu =
    old != null && comment != null && toOverallText(normalizeEvalNotes(old.notes)) === comment;
  const commentChanged = (old?.comment ?? null) !== comment && !chiChuyenDangPhieuCu;

  // Chặn phiếu TRẮNG ở SERVER (trước 21/08 chỉ có chốt ở hộp thoại).
  //
  // Các màn "đã nhận xét x/y" (site GV, /admin/attendance) đếm theo DÒNG chứ không mở
  // JSON ra soi, nên một dòng trắng làm chúng báo "nhận xét xong" cho buổi chưa ai viết
  // gì — và `comment.added` bên dưới còn bắn thông báo cho phụ huynh. Hộp thoại hiện luôn
  // gửi đủ 9 tiêu chí rubric nên nhánh này không chạm người dùng thật; nó đóng đường cho
  // caller khác (và cho zod nay để mọi khoá notes optional).
  // Phiếu ĐANG SỬA không chặn: `old != null` nghĩa là nội dung cũ vẫn còn đó.
  if (old == null && comment === null && Object.keys(rubric).length === 0) {
    return { ok: false, error: "Phiếu chưa có nội dung — viết đánh giá chung hoặc chấm tiêu chí." };
  }

  // Trần 2000 ký tự áp cho nội dung GV VỪA SỬA. Nội dung CŨ (4 mục ghép lại) có thể dài
  // hơn; giữ nguyên không sửa thì cho qua, nếu không giáo viên bị khoá cứng khỏi chính
  // phiếu của mình — kể cả khi chỉ đổi một ô năng lực. Xem EVAL_OVERALL_HARD_MAX.
  if (
    notes.overall.length > EVAL_OVERALL_MAX &&
    notes.overall !== toOverallText(normalizeEvalNotes(old?.notes))
  ) {
    return {
      ok: false,
      error: `Đánh giá chung dài ${notes.overall.length} ký tự — tối đa ${EVAL_OVERALL_MAX}.`,
    };
  }

  // 19/08 — ĐỪNG xoá "nhận xét nhanh" của đường kia.
  //
  // Repo có hai đường ghi vào cùng bảng: đường này (4 mục + rubric) và
  // saveSessionFeedbackCore (comment + sao). Phiếu ở đây coi `comment` là 4 mục nối lại,
  // nên GV mở hộp thoại rubric — vốn KHÔNG hiển thị nhận xét nhanh đang có — chấm sao rồi
  // bấm Lưu là ghi `comment = null`, tức xoá trắng nội dung người khác vừa viết mà không
  // ai thấy. Chỉ giữ lại khi phiếu cũ đúng là loại "chỉ có comment" (không có 4 mục);
  // nếu phiếu cũ vốn có notes thì xoá hết 4 mục = có ý xoá văn xuôi, làm đúng như thế.
  // ⚠️ KHÔNG suy loại phiếu từ `old.notes == null`: chính hàm này LUÔN ghi `notes` đủ 5
  // khoá (spread EMPTY_NOTES ở trên), nên sau lần lưu rubric ĐẦU TIÊN `notes` là một
  // object toàn chuỗi rỗng — khác null. Lấy null làm dấu hiệu thì từ lần lưu thứ hai trở
  // đi guard tắt và nhận xét nhanh bị xoá đúng như trước khi vá. Phải hỏi "có mục nào có
  // chữ không" — `parseFeedbackNotes` từ 21/08 xét cả `overall` lẫn 4 khoá cũ.
  const oldIsQuickCommentOnly =
    old != null && parseFeedbackNotes(old.notes) === null && !!old.comment?.trim();
  const commentPatch = comment !== null || !oldIsQuickCommentOnly ? { comment } : {};

  let saved: { id: string };
  try {
    saved = await sdb.studentSessionFeedback.upsert({
      where: { classSessionId_studentId: { classSessionId: sessionId, studentId } },
      // FIX #5 — update KHÔNG ghi đè createdById (giữ tác giả phiếu gốc).
      update: {
        projectName: projectName ?? null,
        notes,
        rubric,
        ...commentPatch,
      },
      create: {
        classSessionId: sessionId,
        studentId,
        projectName: projectName ?? null,
        notes,
        rubric,
        comment,
        createdById: user.id,
      },
      select: { id: true },
    });
  } catch (err) {
    return {
      ok: false,
      error: `Lỗi lưu phiếu: ${err instanceof Error ? err.message : "Unknown"}`,
    };
  }

  // Thông báo PH — in-app (event) + email (khi văn xuôi ĐỔI), như saveSessionFeedback.
  try {
    await publishEvent(
      "comment.added",
      { studentId, sessionId, commentId: saved.id, byUserId: user.id },
      { dedupeKey: `comment.added:${saved.id}` },
    );
  } catch (err) {
    console.error("[saveSessionEval] publish comment.added error:", err);
  }
  if (tuyChon.guiEmailPhuHuynh && comment && commentChanged) {
    try {
      const [student, cls] = await Promise.all([
        sdb.student.findFirst({
          where: { id: studentId, parentUserId: { not: null } },
          select: {
            name: true,
            parentName: true,
            parentUser: { select: { email: true, name: true } },
          },
        }),
        sdb.classSession.findUnique({
          where: { id: sessionId },
          select: { centerId: true, class: { select: { name: true } } },
        }),
      ]);
      const email = student?.parentUser?.email;
      if (email) {
        await enqueueNewFeedback({
          to: email,
          parentName: student.parentUser?.name ?? student.parentName,
          studentName: student.name,
          className: cls?.class.name ?? "",
          comment,
          rating: null,
        });
      }
    } catch (err) {
      console.error("[saveSessionEval] enqueue email error:", err);
    }
  }

  return { ok: true };
}
