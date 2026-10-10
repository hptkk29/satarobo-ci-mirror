"use server";

// lib/eval/session-eval-actions.ts — FL4-01: server actions cho GV điền phiếu
// đánh giá BUỔI HỌC (SESSION_EVAL). GV chỉ ĐIỀN; cấu hình form/đợt nằm ở
// app/(admin)/admin/evaluations (gate evaluations:manage). Hai action:
//  - loadSessionEvalAction: nạp phiếu đang áp cho buổi + đáp án đã lưu.
//  - saveSessionEvalAction: lưu phiếu theo từng HS (idempotent round×buổi×HS).
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { hasRole } from "@/lib/auth/permissions";
import { getFreshGateUser } from "@/lib/auth/fresh-gate-user";
import { resolveActor } from "@/lib/auth/actor";
import { passesScope } from "@/lib/db-scope";
import { checkPermission } from "@/lib/auth/check-permission";
import { getSessionRosterStudentIds } from "@/lib/attendance/roster";
import {
  getSessionEvalState,
  getTrialSessionEvalState,
  saveSessionEvalResponses,
  saveTrialSessionEvalResponses,
  type SessionEvalState,
} from "@/lib/eval/session-eval";

type Result<T> = { ok: true; data: T } | { ok: false; error: string };

/**
 * Gate ĐIỀN phiếu buổi: GV chính/trợ giảng của lớp, CENTER_MANAGER cùng cơ sở,
 * hoặc SUPER_ADMIN/TRAINING. Mirror canManageSessionClass (LMS-2) nhưng cho phép
 * thêm TRAINING (Đào tạo có thể điền/sửa hộ).
 */
async function gateFill(
  sessionId: string,
): Promise<
  { ok: true; classCenterId: string | null; userId: string } | { ok: false; error: string }
> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: "Chưa đăng nhập" };

  const sess = await db.classSession.findUnique({
    where: { id: sessionId },
    select: { id: true, class: { select: { teacherId: true, assistantId: true, centerId: true } } },
  });
  if (!sess) return { ok: false, error: "Buổi học không tồn tại" };

  // Vai + cơ sở TỪ DB, không từ JWT (xem lib/auth/fresh-gate-user.ts).
  const u = { id: session.user.id, ...((await getFreshGateUser(session.user.id)) ?? session.user) };
  const cls = sess.class;
  const allowed =
    hasRole(u, "SUPER_ADMIN") ||
    hasRole(u, "TRAINING") ||
    (hasRole(u, "CENTER_MANAGER") && !!cls.centerId && cls.centerId === u.centerId) ||
    (hasRole(u, "TEACHER") && (cls.teacherId === u.id || cls.assistantId === u.id));

  if (!allowed) return { ok: false, error: "Không có quyền điền phiếu buổi học này" };
  return { ok: true, classCenterId: cls.centerId, userId: u.id };
}

/** Nạp phiếu SESSION_EVAL đang áp cho buổi (kèm đáp án đã lưu). */
export async function loadSessionEvalAction(sessionId: string): Promise<Result<SessionEvalState>> {
  const g = await gateFill(sessionId);
  if (!g.ok) return g;
  const state = await getSessionEvalState(sessionId);
  return { ok: true, data: state };
}

const saveSchema = z.object({
  sessionId: z.string().min(1),
  roundId: z.string().min(1),
  submissions: z
    .array(
      z.object({
        studentId: z.string().min(1),
        answers: z.array(
          z.object({
            questionId: z.string().min(1),
            valueNumber: z.number().int().nullable().optional(),
            valueOptions: z.array(z.string()).nullable().optional(),
            valueText: z.string().nullable().optional(),
          }),
        ),
      }),
    )
    .max(100),
});

/** Lưu phiếu SESSION_EVAL theo từng HS cho 1 buổi. */
export async function saveSessionEvalAction(input: unknown): Promise<Result<{ saved: number }>> {
  const parsed = saveSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" };

  const g = await gateFill(parsed.data.sessionId);
  if (!g.ok) return g;

  // Lấy form/đợt ĐANG ÁP từ server (không tin client). Đợt phải còn MỞ + khớp buổi,
  // và roundId client gửi phải trùng → chặn ghi vào đợt đã đóng/đổi giữa chừng.
  // SEC-M02 cho hệ SESSION_EVAL — 19/08. Guard này ĐÃ CÓ ở đường nhận xét buổi
  // (saveSessionEvalCore, _feedback-core.ts) nhưng bị bỏ sót ở đây: studentId đến thẳng
  // từ client nên GV của lớp A ghi được phiếu đánh giá cho học viên bất kỳ của lớp/cơ sở
  // khác, và phiếu đó hiện lên trong báo cáo đợt khảo sát như phiếu thật.
  const actor = await resolveActor(g.userId);
  const rosterIds = await getSessionRosterStudentIds(actor, parsed.data.sessionId);
  if (parsed.data.submissions.some((sub) => !rosterIds.has(sub.studentId))) {
    return { ok: false, error: "Có học viên không thuộc danh sách buổi này" };
  }

  const state = await getSessionEvalState(parsed.data.sessionId);
  if (!state.active) return { ok: false, error: "Buổi học chưa có phiếu đánh giá đang mở" };
  if (state.roundId !== parsed.data.roundId) {
    return { ok: false, error: "Đợt đánh giá đã thay đổi — vui lòng tải lại phiếu" };
  }

  const res = await saveSessionEvalResponses(
    state.roundId,
    parsed.data.sessionId,
    state.questions,
    parsed.data.submissions.map((s) => ({
      studentId: s.studentId,
      answers: s.answers.map((a) => ({
        questionId: a.questionId,
        valueNumber: a.valueNumber ?? null,
        valueOptions: a.valueOptions ?? null,
        valueText: a.valueText ?? null,
      })),
    })),
  );
  if (!res.ok) return { ok: false, error: res.error };

  revalidatePath(`/sessions/${parsed.data.sessionId}`);
  return { ok: true, data: { saved: res.saved } };
}

// ─── FL4 (R4) — phiếu SESSION_EVAL cho buổi LỚP TRẢI NGHIỆM (TrialClassSession) ──

/**
 * Gate ĐIỀN phiếu buổi trải nghiệm: GV phụ trách/trợ giảng lớp trải nghiệm,
 * CENTER_MANAGER cùng cơ sở, hoặc SUPER_ADMIN/TRAINING. Mirror gateFill.
 */
async function gateTrialFill(
  trialSessionId: string,
): Promise<{ ok: true; trialClassId: string } | { ok: false; error: string }> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: "Chưa đăng nhập" };

  const sess = await db.trialClassSession.findUnique({
    where: { id: trialSessionId },
    select: {
      id: true,
      teacherId: true,
      trialClassId: true,
      trialClass: { select: { teacherId: true, assistantId: true, centerId: true } },
    },
  });
  if (!sess) return { ok: false, error: "Buổi học trải nghiệm không tồn tại" };

  // Vai + cơ sở TỪ DB, không từ JWT (xem lib/auth/fresh-gate-user.ts).
  const u = { id: session.user.id, ...((await getFreshGateUser(session.user.id)) ?? session.user) };
  const cls = sess.trialClass;

  const allowedByRole =
    hasRole(u, "SUPER_ADMIN") ||
    hasRole(u, "TRAINING") ||
    (hasRole(u, "CENTER_MANAGER") && !!cls.centerId && cls.centerId === u.centerId) ||
    (hasRole(u, "TEACHER") &&
      (cls.teacherId === u.id || cls.assistantId === u.id || sess.teacherId === u.id));

  // GĐ3 — giáo viên được Đào tạo PHÂN CÔNG cho một ca của lớp này.
  //
  // ⚠️ Các nhánh trên chỉ nhìn giáo viên của LỚP/BUỔI. Từ GĐ3 phân công đi theo TỪNG CA
  // (`TrialEnrollment.gvPhanCongId`), nên người thật sự dạy ca lại bị chặn nộp phiếu.
  // Kiểm ở cấp LỚP (không phải cấp buổi) cho khớp guard danh sách học viên bên dưới —
  // guard đó cũng đối chiếu roster của cả lớp trải nghiệm. Chỉ truy vấn khi các nhánh
  // rẻ đã trượt.
  const allowed =
    allowedByRole ||
    (hasRole(u, "TEACHER") &&
      (await db.trialEnrollment.count({
        where: { trialClassId: sess.trialClassId, gvPhanCongId: u.id },
      })) > 0);

  if (!allowed) return { ok: false, error: "Không có quyền điền phiếu buổi học thử này" };
  return { ok: true, trialClassId: sess.trialClassId };
}

/**
 * Gate ĐỌC phiếu buổi trải nghiệm — TÁCH khỏi `gateTrialFill` (27/08/2026).
 *
 * Lỗi đã báo: giáo viên chấm xong, Sale mở màn Lớp Trial ra KHÔNG thấy phiếu. Đường
 * đọc dùng chung cổng với đường ghi, mà cổng ghi chỉ liệt kê SUPER_ADMIN · TRAINING ·
 * CENTER_MANAGER cùng cơ sở · TEACHER của lớp/buổi/ca. `CENTER_SALES_CSM` không nằm
 * trong đó nên bấm mở phiếu chỉ nhận "Không có quyền điền phiếu buổi học thử này".
 *
 * Sale PHẢI đọc được: kết quả đánh giá là căn cứ để chốt với phụ huynh — đó là lý do
 * cả màn tồn tại. Sale vẫn KHÔNG chấm được: `saveTrialSessionEvalAction` giữ nguyên
 * `gateTrialFill`. Đúng lớp lỗi GĐ4 đã sửa một lần cho điểm danh, lần này lọt ở đường
 * đọc.
 *
 * Gác bằng QUYỀN chứ không liệt kê vai (luật cứng #1): `trials:view` — đúng quyền mà
 * trang lớp trải nghiệm đã dùng để mở màn, nên ai vào được màn thì đọc được phiếu của
 * chính lớp đang mở. Kèm `passesScope` để cách ly cơ sở, vì `trials:view` seed ở
 * scope GLOBAL và bản thân nó không giới hạn cơ sở nào.
 */
async function gateTrialRead(
  trialSessionId: string,
): Promise<{ ok: true; trialClassId: string } | { ok: false; error: string }> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: "Chưa đăng nhập" };

  const sess = await db.trialClassSession.findUnique({
    where: { id: trialSessionId },
    select: {
      trialClassId: true,
      trialClass: { select: { centerId: true } },
    },
  });
  if (!sess) return { ok: false, error: "Buổi học trải nghiệm không tồn tại" };

  const centerId = sess.trialClass?.centerId ?? null;
  const actor = await resolveActor(session.user.id);
  // Cách ly cơ sở TRƯỚC khi báo thiếu quyền: lớp ngoài tầm nhìn thì trả lời y như lớp
  // không tồn tại, không xác nhận gián tiếp là nó có thật.
  if (!passesScope("TrialClassV2", { centerId }, actor)) {
    return { ok: false, error: "Buổi học trải nghiệm không tồn tại" };
  }
  if (!(await checkPermission("trials:view", { centerId }))) {
    return { ok: false, error: "Không có quyền xem phiếu buổi học thử này" };
  }
  return { ok: true, trialClassId: sess.trialClassId };
}

/** Nạp phiếu SESSION_EVAL đang áp cho buổi LỚP TRẢI NGHIỆM (kèm đáp án đã lưu). */
export async function loadTrialSessionEvalAction(
  trialSessionId: string,
): Promise<Result<SessionEvalState>> {
  const g = await gateTrialRead(trialSessionId);
  if (!g.ok) return g;
  const state = await getTrialSessionEvalState(trialSessionId);
  return { ok: true, data: state };
}

const saveTrialSchema = z.object({
  trialSessionId: z.string().min(1),
  roundId: z.string().min(1),
  submissions: z
    .array(
      z.object({
        studentId: z.string().min(1),
        answers: z.array(
          z.object({
            questionId: z.string().min(1),
            valueNumber: z.number().int().nullable().optional(),
            valueOptions: z.array(z.string()).nullable().optional(),
            valueText: z.string().nullable().optional(),
          }),
        ),
      }),
    )
    .max(100),
});

/** Lưu phiếu SESSION_EVAL theo từng HS cho 1 buổi LỚP TRẢI NGHIỆM. */
export async function saveTrialSessionEvalAction(input: unknown): Promise<Result<{ saved: number }>> {
  const parsed = saveTrialSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" };

  const g = await gateTrialFill(parsed.data.trialSessionId);
  if (!g.ok) return g;

  // Cùng guard SEC-M02 như lớp chính. Với lớp trải nghiệm, "studentId" của EvalResponse
  // chính là LeadChild.id (xem admin/trial-classes/[id]/page.tsx nơi dựng danh sách).
  const trialRoster = await db.trialEnrollment.findMany({
    where: { trialClassId: g.trialClassId, status: { in: ["ACTIVE", "COMPLETED"] } },
    select: { id: true, leadChildId: true },
  });
  const trialIds = new Set(trialRoster.flatMap((e) => [e.leadChildId, e.id]));
  if (parsed.data.submissions.some((sub) => !trialIds.has(sub.studentId))) {
    return { ok: false, error: "Có học viên không thuộc lớp trải nghiệm này" };
  }

  const state = await getTrialSessionEvalState(parsed.data.trialSessionId);
  if (!state.active) return { ok: false, error: "Buổi học thử chưa có phiếu đánh giá đang mở" };
  if (state.roundId !== parsed.data.roundId) {
    return { ok: false, error: "Đợt đánh giá đã thay đổi — vui lòng tải lại phiếu" };
  }

  const res = await saveTrialSessionEvalResponses(
    state.roundId,
    parsed.data.trialSessionId,
    state.questions,
    parsed.data.submissions.map((s) => ({
      studentId: s.studentId,
      answers: s.answers.map((a) => ({
        questionId: a.questionId,
        valueNumber: a.valueNumber ?? null,
        valueOptions: a.valueOptions ?? null,
        valueText: a.valueText ?? null,
      })),
    })),
  );
  if (!res.ok) return { ok: false, error: res.error };

  revalidatePath("/lop-trial");
  return { ok: true, data: { saved: res.saved } };
}
