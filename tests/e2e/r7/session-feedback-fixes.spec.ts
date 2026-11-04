/**
 * Vá 6 lỗi NHẬN XÉT HỌC VIÊN THEO BUỔI (08/2026) — Postgres LOCAL (.env.test).
 * Test service-level (mẫu bulk-convert / teacher-session-actions): action wrapper cần
 * auth() mà bundle Playwright STUB `@/lib/auth` → auth() = null, nên spec gọi thẳng
 * CORE đã tách (app/(admin)/admin/sessions/[id]/_feedback-core.ts):
 * saveSessionFeedbackCore / saveSessionEvalCore / canManageSessionRecord — logic THẬT
 * của action, chỉ thiếu lớp auth() + revalidatePath.
 *
 * Phủ:
 *  [SFB-01] dòng comment rỗng + phiếu CÓ rubric → GIỮ rubric (lý do chính của đợt vá).
 *  [SFB-02] dòng comment rỗng + phiếu KHÔNG có phần mở rộng → xoá như hành vi cũ.
 *  [SFB-03] GV DẠY THAY (substituteTeacherId) lưu được nhận xét; GV ngoài buổi bị chặn.
 *  [SFB-04] re-save không đổi comment → KHÔNG sinh thêm EmailQueue; đổi thật → +1.
 *  [SFB-05] update không ghi đè createdById (giữ tác giả phiếu gốc).
 *  [SFB-06] saveSessionEvalCore: rubric-only không email; re-save không đổi văn xuôi
 *           không email trùng; người sửa sau không cướp tác giả.
 *  [SFB-07] guiEmailPhuHuynh=false (seed thử, 26/09): phiếu VẪN lưu đúng tác giả + VẪN phát
 *           comment.added, nhưng KHÔNG xếp email — đối chứng dương: cùng phiếu, true ⇒ có email.
 */
import { test, expect } from "@playwright/test";
import { db } from "../../../lib/db";
import { resetDb, seedOrg, seedRoles, seedUser } from "../_helpers/seed";
import { testEmail } from "../_helpers/fixtures";
import { assignUserOrgRole, type RbacActor } from "../../../lib/auth/rbac-service";
import {
  saveSessionFeedbackCore,
  saveSessionEvalCore,
  canManageSessionRecord,
  type SessionGateUser,
} from "../../../app/(admin)/admin/sessions/[id]/_feedback-core";

const SA: RbacActor = { id: "seed-sa", name: "SA", role: "SUPER_ADMIN" };

let seq = 0;
const uniq = () => `${Date.now().toString(36)}${seq++}`;

async function orgId(code: string) {
  return (await db.orgUnit.findUnique({ where: { code }, select: { id: true } }))!.id;
}
async function centerIdOf(code: string) {
  return (await db.orgUnit.findUnique({ where: { code }, select: { centerId: true } }))!.centerId!;
}
async function roleIdOf(code: string) {
  return (await db.roleDef.findUnique({ where: { code }, select: { id: true } }))!.id;
}

/** GV = User + UserOrgRole(TEACHER @ CS1) — scopedDb thấy buổi CS1. */
async function makeTeacher(slug: string) {
  const u = await seedUser({ email: testEmail(slug), role: "TEACHER" });
  await assignUserOrgRole(SA, {
    userId: u.id,
    orgUnitId: await orgId("CS1"),
    roleId: await roleIdOf("TEACHER"),
    reason: "seed session-feedback-fixes",
  });
  return u;
}

const gvUser = (id: string): SessionGateUser => ({ id, role: "TEACHER", centerId: null });

/** Khoá + lớp (CS1, teacherId tuỳ chọn) + buổi (centerId, substituteTeacherId tuỳ chọn). */
async function seedClassSession(opts: {
  teacherId?: string | null;
  substituteTeacherId?: string | null;
}) {
  const c = await centerIdOf("CS1");
  const rand = uniq();
  const course = await db.course.create({
    data: { name: `Khoá NX ${rand}`, slug: `nx-${rand}` },
    select: { id: true },
  });
  const cls = await db.class.create({
    data: {
      name: `Lớp NX ${rand}`,
      courseId: course.id,
      centerId: c,
      teacherId: opts.teacherId ?? null,
      status: "ACTIVE",
    },
    select: { id: true },
  });
  const sess = await db.classSession.create({
    data: {
      classId: cls.id,
      date: new Date(),
      centerId: c,
      substituteTeacherId: opts.substituteTeacherId ?? null,
    },
    select: { id: true },
  });
  return { centerId: c, courseId: course.id, classId: cls.id, sessionId: sess.id };
}

/** HV enrolled ACTIVE (∈ roster SEC-M02) + điểm danh PRESENT; tuỳ chọn TK phụ huynh có email. */
async function seedStudent(
  ctx: { centerId: string; courseId: string; classId: string; sessionId: string },
  opts?: { withParent?: boolean },
) {
  const rand = uniq();
  let parentUserId: string | null = null;
  if (opts?.withParent) {
    const p = await seedUser({ email: testEmail(`ph-${rand}`), role: "PARENT" });
    parentUserId = p.id;
  }
  const st = await db.student.create({
    data: { name: `HS NX ${rand}`, centerId: ctx.centerId, parentUserId },
    select: { id: true },
  });
  await db.enrollment.create({
    data: {
      studentId: st.id,
      classId: ctx.classId,
      courseId: ctx.courseId,
      status: "ACTIVE",
      centerId: ctx.centerId, // Enrollment ∈ SCOPED_MODELS — create PHẢI set centerId
    },
  });
  await db.attendance.create({
    data: { sessionId: ctx.sessionId, studentId: st.id, status: "PRESENT", centerId: ctx.centerId },
  });
  return st;
}

const fbWhere = (sessionId: string, studentId: string) => ({
  classSessionId_studentId: { classSessionId: sessionId, studentId },
});

const emailCount = () => db.emailQueue.count({ where: { contextType: "NEW_FEEDBACK" } });

test.describe("[SFB] Nhận xét theo buổi — 6 fix 08/2026", () => {
  test.beforeEach(async () => {
    await resetDb();
    await db.center.create({
      data: { code: "CS1", name: "CS1", slug: "cs1-sfb", address: "a", city: "" },
    });
    await seedOrg(["HO", "CS1"]);
    await seedRoles();
  });

  test("[SFB-01] dòng comment rỗng KHÔNG xoá phiếu có rubric — rubric/projectName còn nguyên", async () => {
    const gv = await makeTeacher("gv-sfb1");
    const s = await seedClassSession({ teacherId: gv.id });
    const st = await seedStudent(s);

    // Phiếu rubric-only (GV chấm dropdown ở hub lớp, comment = null) — nạn nhân bug cũ:
    // /teacher/nhan-xet prefill "" → "Lưu tất cả" gửi dòng rỗng → deleteMany nuốt phiếu.
    await db.studentSessionFeedback.create({
      data: {
        classSessionId: s.sessionId,
        studentId: st.id,
        comment: null,
        projectName: "Dự án 1: Robot dò line",
        notes: { knowledge: "", skill: "", attitude: "", proposal: "" },
        rubric: { "kt-cu": 2, "kn-st": 4 },
        createdById: gv.id,
      },
    });

    const res = await saveSessionFeedbackCore(gvUser(gv.id), {
      sessionId: s.sessionId,
      items: [{ studentId: st.id, comment: "", rating: null }],
    });
    expect(res.ok).toBe(true);

    const after = await db.studentSessionFeedback.findUnique({
      where: fbWhere(s.sessionId, st.id),
    });
    expect(after).not.toBeNull(); // phiếu KHÔNG bị xoá
    expect(after!.rubric).toEqual({ "kt-cu": 2, "kn-st": 4 }); // rubric còn nguyên
    expect(after!.projectName).toBe("Dự án 1: Robot dò line");
    expect(after!.comment).toBeNull();
    expect(after!.rating).toBeNull();
    expect(after!.createdById).toBe(gv.id);
  });

  test("[SFB-02] dòng comment rỗng + phiếu KHÔNG có phần mở rộng → xoá như hành vi cũ", async () => {
    const gv = await makeTeacher("gv-sfb2");
    const s = await seedClassSession({ teacherId: gv.id });
    const st1 = await seedStudent(s); // có phiếu thuần comment → sẽ bị xoá
    const st2 = await seedStudent(s); // chưa có phiếu → dòng rỗng là no-op

    await db.studentSessionFeedback.create({
      data: {
        classSessionId: s.sessionId,
        studentId: st1.id,
        comment: "Con ngoan",
        rating: 4,
        createdById: gv.id,
      },
    });

    const res = await saveSessionFeedbackCore(gvUser(gv.id), {
      sessionId: s.sessionId,
      items: [
        { studentId: st1.id, comment: "", rating: null },
        { studentId: st2.id, comment: "", rating: null },
      ],
    });
    expect(res.ok).toBe(true);

    expect(await db.studentSessionFeedback.findUnique({ where: fbWhere(s.sessionId, st1.id) })).toBeNull();
    expect(await db.studentSessionFeedback.count({ where: { classSessionId: s.sessionId } })).toBe(0);
  });

  test("[SFB-03] GV dạy thay (substituteTeacherId) lưu được nhận xét; GV ngoài buổi bị chặn", async () => {
    const gv1 = await makeTeacher("gv-sfb3a"); // GV chính của lớp
    const gv2 = await makeTeacher("gv-sfb3b"); // dạy thay buổi này
    const gv3 = await makeTeacher("gv-sfb3c"); // ngoài cuộc (cùng cơ sở)
    const s = await seedClassSession({ teacherId: gv1.id, substituteTeacherId: gv2.id });
    const st = await seedStudent(s);

    // Người THỰC DẠY lưu được — trước fix bị "Không có quyền" (gate chỉ nhìn lớp).
    const res = await saveSessionFeedbackCore(gvUser(gv2.id), {
      sessionId: s.sessionId,
      items: [{ studentId: st.id, comment: "Bé tiếp thu tốt buổi dạy thay", rating: 5 }],
    });
    expect(res.ok).toBe(true);
    const row = await db.studentSessionFeedback.findUnique({ where: fbWhere(s.sessionId, st.id) });
    expect(row?.comment).toBe("Bé tiếp thu tốt buổi dạy thay");
    expect(row?.createdById).toBe(gv2.id);

    // GV không liên quan buổi → vẫn bị chặn (gate không mở rộng quá đà).
    const denied = await saveSessionFeedbackCore(gvUser(gv3.id), {
      sessionId: s.sessionId,
      items: [{ studentId: st.id, comment: "không được ghi", rating: null }],
    });
    expect(denied.ok).toBe(false);
    expect(row?.comment).toBe("Bé tiếp thu tốt buổi dạy thay"); // không bị ghi đè

    // Predicate gate 2 chiều.
    const sessRow = await db.classSession.findUniqueOrThrow({
      where: { id: s.sessionId },
      select: {
        classId: true,
        substituteTeacherId: true,
        actualTeacherId: true,
        class: { select: { centerId: true } },
      },
    });
    expect(await canManageSessionRecord(gvUser(gv2.id), sessRow)).toBe(true);
    expect(await canManageSessionRecord(gvUser(gv3.id), sessRow)).toBe(false);
  });

  test("[SFB-04] re-save không đổi comment → KHÔNG sinh thêm EmailQueue; đổi thật → +1", async () => {
    const gv = await makeTeacher("gv-sfb4");
    const s = await seedClassSession({ teacherId: gv.id });
    const st = await seedStudent(s, { withParent: true });

    const input = {
      sessionId: s.sessionId,
      items: [{ studentId: st.id, comment: "Bé ngoan", rating: 4 }],
    };
    expect((await saveSessionFeedbackCore(gvUser(gv.id), input)).ok).toBe(true);
    expect(await emailCount()).toBe(1);

    // Lưu lại y nguyên (client cũ gửi cả lớp mỗi lần bấm) → không email trùng.
    expect((await saveSessionFeedbackCore(gvUser(gv.id), input)).ok).toBe(true);
    expect(await emailCount()).toBe(1);

    // Chỉ đổi sao, comment giữ nguyên → cũng không email lại.
    expect(
      (
        await saveSessionFeedbackCore(gvUser(gv.id), {
          sessionId: s.sessionId,
          items: [{ studentId: st.id, comment: "Bé ngoan", rating: 5 }],
        })
      ).ok,
    ).toBe(true);
    expect(await emailCount()).toBe(1);

    // Comment thực sự đổi → +1 email.
    expect(
      (
        await saveSessionFeedbackCore(gvUser(gv.id), {
          sessionId: s.sessionId,
          items: [{ studentId: st.id, comment: "Bé rất ngoan, tiến bộ rõ", rating: 5 }],
        })
      ).ok,
    ).toBe(true);
    expect(await emailCount()).toBe(2);
  });

  test("[SFB-05] update không ghi đè createdById — giữ tác giả phiếu gốc", async () => {
    const gv1 = await makeTeacher("gv-sfb5a");
    const gv2 = await makeTeacher("gv-sfb5b");
    const s = await seedClassSession({ teacherId: gv1.id, substituteTeacherId: gv2.id });
    const st = await seedStudent(s);

    expect(
      (
        await saveSessionFeedbackCore(gvUser(gv1.id), {
          sessionId: s.sessionId,
          items: [{ studentId: st.id, comment: "Nhận xét gốc của GV chính", rating: 4 }],
        })
      ).ok,
    ).toBe(true);

    // GV dạy thay sửa lại — comment đổi nhưng TÁC GIẢ gốc giữ nguyên (PDF/portal in đúng tên).
    expect(
      (
        await saveSessionFeedbackCore(gvUser(gv2.id), {
          sessionId: s.sessionId,
          items: [{ studentId: st.id, comment: "GV dạy thay bổ sung nhận xét", rating: 5 }],
        })
      ).ok,
    ).toBe(true);

    const row = await db.studentSessionFeedback.findUnique({ where: fbWhere(s.sessionId, st.id) });
    expect(row?.comment).toBe("GV dạy thay bổ sung nhận xét");
    expect(row?.createdById).toBe(gv1.id); // KHÔNG bị cướp tác giả
  });

  test("[SFB-06] phiếu eval: rubric-only không email; re-save y nguyên không email trùng; người sửa sau không cướp tác giả", async () => {
    const gv1 = await makeTeacher("gv-sfb6a");
    const gv2 = await makeTeacher("gv-sfb6b");
    const s = await seedClassSession({ teacherId: gv1.id, substituteTeacherId: gv2.id });
    const st = await seedStudent(s, { withParent: true });

    const emptyNotes = { knowledge: "", skill: "", attitude: "", proposal: "" };

    // 1) Rubric-only (4 mục trống) → comment null → KHÔNG email.
    expect(
      (
        await saveSessionEvalCore(gvUser(gv1.id), {
          sessionId: s.sessionId,
          studentId: st.id,
          projectName: "Dự án 2: Cánh tay robot",
          notes: emptyNotes,
          rubric: { "kt-cu": 1 },
        }, { guiEmailPhuHuynh: true })
      ).ok,
    ).toBe(true);
    expect(await emailCount()).toBe(0);
    let row = await db.studentSessionFeedback.findUnique({ where: fbWhere(s.sessionId, st.id) });
    expect(row?.comment).toBeNull();
    expect(row?.createdById).toBe(gv1.id);

    // 2) Thêm văn xuôi → comment đổi (null → text) → +1 email.
    const withProse = {
      sessionId: s.sessionId,
      studentId: st.id,
      projectName: "Dự án 2: Cánh tay robot",
      notes: { ...emptyNotes, knowledge: "Nắm vững vòng lặp" },
      rubric: { "kt-cu": 1 },
    };
    expect((await saveSessionEvalCore(gvUser(gv1.id), withProse, { guiEmailPhuHuynh: true })).ok).toBe(true);
    expect(await emailCount()).toBe(1);

    // 3) Re-save Y NGUYÊN → comment không đổi → không email trùng.
    expect((await saveSessionEvalCore(gvUser(gv1.id), withProse, { guiEmailPhuHuynh: true })).ok).toBe(true);
    expect(await emailCount()).toBe(1);

    // 4) GV dạy thay sửa văn xuôi (fix #3 phủ luôn saveSessionEval) → +1 email,
    //    createdById vẫn của GV tạo phiếu.
    expect(
      (
        await saveSessionEvalCore(gvUser(gv2.id), {
          ...withProse,
          notes: { ...emptyNotes, knowledge: "Nắm vững vòng lặp, tự mở rộng điều kiện" },
          rubric: { "kt-cu": 2 },
        }, { guiEmailPhuHuynh: true })
      ).ok,
    ).toBe(true);
    expect(await emailCount()).toBe(2);
    row = await db.studentSessionFeedback.findUnique({ where: fbWhere(s.sessionId, st.id) });
    expect(row?.createdById).toBe(gv1.id);
    expect(row?.rubric).toEqual({ "kt-cu": 2 });
  });
  test("[SFB-07] guiEmailPhuHuynh=false: lưu + phát sự kiện như thường, KHÔNG xếp email", async () => {
    const gv = await makeTeacher("gv-sfb7");
    const s = await seedClassSession({ teacherId: gv.id });
    const st = await seedStudent(s, { withParent: true });
    const input = {
      sessionId: s.sessionId,
      studentId: st.id,
      projectName: "Dự án 3: Xe dò vạch",
      notes: { overall: "Con lắp ráp gọn, cần luyện thêm phần căn chỉnh." },
      rubric: { "kt-cu": 3 },
    };

    expect((await saveSessionEvalCore(gvUser(gv.id), input, { guiEmailPhuHuynh: false })).ok).toBe(true);
    const row = await db.studentSessionFeedback.findUnique({ where: fbWhere(s.sessionId, st.id) });
    expect(row?.comment).toBe("Con lắp ráp gọn, cần luyện thêm phần căn chỉnh.");
    expect(row?.createdById).toBe(gv.id);
    expect(await emailCount()).toBe(0);
    expect(
      await db.domainEvent.count({ where: { type: "comment.added", dedupeKey: `comment.added:${row!.id}` } }),
    ).toBe(1);

    // Đối chứng dương: cùng học viên, văn xuôi ĐỔI, cờ true ⇒ có email — chứng minh ca trên
    // ra 0 vì cờ chứ không phải vì phụ huynh không có email.
    expect(
      (
        await saveSessionEvalCore(
          gvUser(gv.id),
          { ...input, notes: { overall: "Con tiến bộ rõ ở phần lập trình." } },
          { guiEmailPhuHuynh: true },
        )
      ).ok,
    ).toBe(true);
    expect(await emailCount()).toBe(1);
  });
});
