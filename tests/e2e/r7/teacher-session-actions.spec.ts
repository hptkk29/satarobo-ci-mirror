/**
 * #06 (L6) — Thao tác buổi trên TRANG LỊCH DẠY site giáo viên:
 *   (A) completeSessionAction  — "Hoàn tất buổi" (lifecycle v2, gate flag).
 *   (B) requestLessonChangeAction — "Đề xuất sửa giáo án" (LessonChangeRequest OPEN).
 * Postgres LOCAL (.env.test).
 *
 * CÁCH TEST (giống attendance-edit.spec / session-lifecycle.spec): server action gọi
 * `auth()` mà bundle Playwright STUB `@/lib/auth` → auth() trả null (tests/stubs/auth.ts),
 * nên KHÔNG chạy trực tiếp được happy-path của action trong runner này. Ta test các KHỐI
 * CẤU THÀNH THẬT mà action dựa vào:
 *   1. isSessionOwnedByTeacher      — predicate THUẦN "buổi thuộc GV" (assigned/substitute/actual).
 *   2. resolveActorUncached          — assignedClassIds nạp từ Class.teacherId (lớp GV).
 *   3. scopedDb(actor).findUnique    — cách ly cơ sở (buổi CS khác → null → "không thuộc bạn").
 *   4. completeSession               — chốt buổi (ok / needsConfirm / confirm) — reuse lib.
 *   5. isSessionLifecycleV2Enabled   — gate flag (OFF → action trả "chưa bật").
 *   6. LessonChangeRequest.create    — tạo đề xuất OPEN cho buổi có lessonId.
 * ⚠️ Câu 46: không đụng dữ liệu PH (chỉ lớp/buổi/bài giảng).
 */
import { test, expect } from "@playwright/test";
import type { Role, SessionStatus } from "@prisma/client";
import { db } from "../../../lib/db";
import { resetDb, seedOrg, seedRoles, seedUser } from "../_helpers/seed";
import { testEmail } from "../_helpers/fixtures";
import {
  assignUserOrgRole,
  type RbacActor,
} from "../../../lib/auth/rbac-service";
import { resolveActorUncached } from "../../../lib/auth/actor";
import { scopedDb } from "../../../lib/db-scope";
import { completeSession } from "../../../lib/lms/session-lifecycle";
import { isSessionOwnedByTeacher } from "../../../lib/lms/session-ownership";
import { isSessionLifecycleV2Enabled } from "../../../lib/flags";

const SA: RbacActor = { id: "seed-sa", name: "SA", role: "SUPER_ADMIN" };

// ─────────────────────────────────────────────────────────────────────────────
// 1) THUẦN — isSessionOwnedByTeacher (không cần DB).
// ─────────────────────────────────────────────────────────────────────────────
test.describe("[#06-U] isSessionOwnedByTeacher — buổi thuộc GV", () => {
  const teacher = { userId: "gv-1", assignedClassIds: new Set(["c-mine"]) };

  test("[#06-U1] lớp ∈ assignedClassIds → true", () => {
    expect(
      isSessionOwnedByTeacher(
        { classId: "c-mine", substituteTeacherId: null, actualTeacherId: null },
        teacher,
      ),
    ).toBe(true);
  });

  test("[#06-U2] dạy thay (substituteTeacherId=userId) lớp không thuộc → true", () => {
    expect(
      isSessionOwnedByTeacher(
        {
          classId: "c-other",
          substituteTeacherId: "gv-1",
          actualTeacherId: null,
        },
        teacher,
      ),
    ).toBe(true);
  });

  test("[#06-U3] thực dạy (actualTeacherId=userId) → true", () => {
    expect(
      isSessionOwnedByTeacher(
        {
          classId: "c-other",
          substituteTeacherId: null,
          actualTeacherId: "gv-1",
        },
        teacher,
      ),
    ).toBe(true);
  });

  test("[#06-U4] lớp GV khác, không dạy thay/thực dạy → false", () => {
    expect(
      isSessionOwnedByTeacher(
        {
          classId: "c-other",
          substituteTeacherId: "gv-2",
          actualTeacherId: "gv-2",
        },
        teacher,
      ),
    ).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2) DB-backed — actor THẬT + cách ly + completeSession + LessonChangeRequest.
// ─────────────────────────────────────────────────────────────────────────────
async function orgId(code: string) {
  return (await db.orgUnit.findUnique({
    where: { code },
    select: { id: true },
  }))!.id;
}
async function centerIdOf(code: string) {
  return (await db.orgUnit.findUnique({
    where: { code },
    select: { centerId: true },
  }))!.centerId!;
}
async function roleIdOf(code: string) {
  return (await db.roleDef.findUnique({
    where: { code },
    select: { id: true },
  }))!.id;
}

/** GV = User + UserOrgRole(TEACHER @ cơ sở). */
async function makeTeacher(
  slug: string,
  orgCode: string,
  primaryRole: Role = "TEACHER",
) {
  const u = await seedUser({ email: testEmail(slug), role: primaryRole });
  await assignUserOrgRole(SA, {
    userId: u.id,
    orgUnitId: await orgId(orgCode),
    roleId: await roleIdOf("TEACHER"),
    reason: "seed #06",
  });
  return u;
}

/** Lớp (centerId + teacherId) + buổi (centerId → scopedDb cách ly). Tuỳ chọn bài giảng + điểm danh. */
async function seedSession(opts: {
  center: string;
  teacherId?: string | null;
  withLesson?: boolean;
  withAttendance?: boolean;
  status?: SessionStatus;
}) {
  const c = await centerIdOf(opts.center);
  const rand = Math.random().toString(36).slice(2, 8);
  const course = await db.course.create({
    data: { name: `Khoá06 ${rand}`, slug: `c06-${rand}` },
    select: { id: true },
  });

  let lessonId: string | null = null;
  if (opts.withLesson) {
    const cur = await db.curriculum.create({
      data: { courseId: course.id, name: `CT06 ${rand}` },
      select: { id: true },
    });
    const lesson = await db.lesson.create({
      data: { curriculumId: cur.id, order: 1, title: `Bài06 ${rand}` },
      select: { id: true },
    });
    lessonId = lesson.id;
  }

  const cls = await db.class.create({
    data: {
      name: `Lớp06 ${rand}`,
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
      status: opts.status ?? "SCHEDULED",
      lessonId,
    },
    select: { id: true },
  });
  if (opts.withAttendance) {
    const st = await db.student.create({
      data: { name: `HS06 ${rand}`, centerId: c },
      select: { id: true },
    });
    await db.attendance.create({
      data: {
        sessionId: sess.id,
        studentId: st.id,
        status: "PRESENT",
        centerId: c,
      },
    });
  }
  return { centerId: c, classId: cls.id, sessionId: sess.id, lessonId };
}

test.describe("[#06-DB] hoàn tất buổi + đề xuất sửa giáo án — ownership + cách ly + flag", () => {
  test.beforeEach(async () => {
    await resetDb();
    await db.center.create({
      data: {
        code: "CS1",
        name: "CS1",
        slug: "cs1-06",
        address: "a",
        city: "",
      },
    });
    await db.center.create({
      data: {
        code: "CS2",
        name: "CS2",
        slug: "cs2-06",
        address: "b",
        city: "",
      },
    });
    await seedOrg(["HO", "CS1", "CS2"]);
    await seedRoles();
  });

  test("[#06-DB1] GV chốt buổi lớp mình (flag ON) + có điểm danh → completeSession ok, buổi COMPLETED", async () => {
    const gv = await makeTeacher("gv1", "CS1");
    const s = await seedSession({
      center: "CS1",
      teacherId: gv.id,
      withAttendance: true,
    });
    const actor = await resolveActorUncached(gv.id);

    // assignedClassIds nạp từ Class.teacherId → lớp GV; scopedDb thấy buổi CS1.
    expect(actor.assignedClassIds.has(s.classId)).toBe(true);
    const owned = await scopedDb(actor).classSession.findUnique({
      where: { id: s.sessionId },
      select: {
        id: true,
        classId: true,
        centerId: true,
        substituteTeacherId: true,
        actualTeacherId: true,
      },
    });
    expect(owned).not.toBeNull();
    expect(
      isSessionOwnedByTeacher(owned!, {
        userId: gv.id,
        assignedClassIds: actor.assignedClassIds,
      }),
    ).toBe(true);

    const res = await completeSession({
      nguonChot: "TAY",
      assignMode: "DEFER", // bắt buộc từ 08/09; test này không nói về giao bài

      sessionId: s.sessionId,
      actorId: gv.id,
      actorName: "GV",
      actualTeacherId: gv.id,
      now: new Date(),
    });
    expect(res.ok).toBe(true);
    expect(res.needsConfirm).toBeFalsy();

    const after = await db.classSession.findUnique({
      where: { id: s.sessionId },
      select: { status: true, actualTeacherId: true },
    });
    expect(after?.status).toBe("COMPLETED");
    expect(after?.actualTeacherId).toBe(gv.id);
  });

  test("[#06-DB2] thiếu điểm danh → needsConfirm; confirm → hoàn tất", async () => {
    const gv = await makeTeacher("gv2", "CS1");
    const s = await seedSession({
      center: "CS1",
      teacherId: gv.id,
      withAttendance: false,
    });

    const warn = await completeSession({
      nguonChot: "TAY",
      assignMode: "DEFER", // bắt buộc từ 08/09; test này không nói về giao bài
      sessionId: s.sessionId,
      actorId: gv.id,
      actorName: "GV",
      actualTeacherId: gv.id,
    });
    expect(warn.ok).toBe(false);
    expect(warn.needsConfirm).toBe(true);

    const done = await completeSession({
      nguonChot: "TAY",
      assignMode: "DEFER", // bắt buộc từ 08/09; test này không nói về giao bài

      sessionId: s.sessionId,
      actorId: gv.id,
      actorName: "GV",
      actualTeacherId: gv.id,
      confirmNoAttendance: true,
    });
    expect(done.ok).toBe(true);
    const after = await db.classSession.findUnique({
      where: { id: s.sessionId },
      select: { status: true },
    });
    expect(after?.status).toBe("COMPLETED");
  });

  test("[#06-DB3] buổi lớp GV KHÁC (cùng cơ sở) → ownership false → 'không thuộc bạn'", async () => {
    const gv = await makeTeacher("gv3", "CS1");
    const other = await seedUser({
      email: testEmail("gv-other"),
      role: "TEACHER",
    });
    const s = await seedSession({
      center: "CS1",
      teacherId: other.id,
      withAttendance: true,
    });
    const actor = await resolveActorUncached(gv.id);

    // scopedDb THẤY buổi (cùng CS1) — nhưng predicate ownership loại (lớp không thuộc GV).
    const owned = await scopedDb(actor).classSession.findUnique({
      where: { id: s.sessionId },
      select: {
        classId: true,
        centerId: true,
        substituteTeacherId: true,
        actualTeacherId: true,
      },
    });
    expect(owned).not.toBeNull();
    expect(actor.assignedClassIds.has(s.classId)).toBe(false);
    expect(
      isSessionOwnedByTeacher(owned!, {
        userId: gv.id,
        assignedClassIds: actor.assignedClassIds,
      }),
    ).toBe(false);
  });

  test("[#06-DB4] cách ly cơ sở: buổi CS2 → scopedDb.findUnique null → 'không thuộc bạn'", async () => {
    const gv = await makeTeacher("gv4", "CS1");
    const s2 = await seedSession({
      center: "CS2",
      teacherId: null,
      withAttendance: true,
    });
    const actor = await resolveActorUncached(gv.id);

    const cs1 = await seedSession({ center: "CS1", teacherId: gv.id });
    const sdb = scopedDb(actor);
    // Buổi CS1 lớp mình đọc được; buổi CS2 ngoài tầm nhìn → null (gate trả "không thuộc bạn").
    expect(
      await sdb.classSession.findUnique({ where: { id: cs1.sessionId } }),
    ).not.toBeNull();
    expect(
      await sdb.classSession.findUnique({ where: { id: s2.sessionId } }),
    ).toBeNull();
  });

  test("[#06-DB5] gate flag lifecycle v2: OFF → 'chưa bật'; ON → cho phép", () => {
    const prev = process.env.SESSION_LIFECYCLE_V2;
    try {
      delete process.env.SESSION_LIFECYCLE_V2;
      expect(isSessionLifecycleV2Enabled()).toBe(false); // action → { ok:false, error:"Tính năng chốt buổi chưa bật" }
      process.env.SESSION_LIFECYCLE_V2 = "true";
      expect(isSessionLifecycleV2Enabled()).toBe(true);
    } finally {
      if (prev === undefined) delete process.env.SESSION_LIFECYCLE_V2;
      else process.env.SESSION_LIFECYCLE_V2 = prev;
    }
  });

  test("[#06-DB6] buổi có lessonId → tạo LessonChangeRequest OPEN; buổi không bài giảng → 'chưa gắn bài giảng'", async () => {
    const gv = await makeTeacher("gv5", "CS1");
    const withLesson = await seedSession({
      center: "CS1",
      teacherId: gv.id,
      withLesson: true,
    });
    const noLesson = await seedSession({
      center: "CS1",
      teacherId: gv.id,
      withLesson: false,
    });
    expect(withLesson.lessonId).not.toBeNull();
    expect(noLesson.lessonId).toBeNull(); // → action trả "Buổi chưa gắn bài giảng"

    const actor = await resolveActorUncached(gv.id);
    const content =
      "Sửa bước 3: đổi cảm biến siêu âm sang hồng ngoại cho phù hợp K-6.";
    // Mirror requestLessonChangeAction: create qua scopedDb (create không bị scope chặn).
    const created = await scopedDb(actor).lessonChangeRequest.create({
      data: {
        lessonId: withLesson.lessonId!,
        requestedById: gv.id,
        content,
        status: "OPEN",
      },
      select: { id: true },
    });

    const row = await db.lessonChangeRequest.findUnique({
      where: { id: created.id },
      select: {
        status: true,
        content: true,
        requestedById: true,
        lessonId: true,
      },
    });
    expect(row?.status).toBe("OPEN");
    expect(row?.content).toBe(content);
    expect(row?.requestedById).toBe(gv.id);
    expect(row?.lessonId).toBe(withLesson.lessonId);
  });

  test("[#06-DB7] đề xuất sửa giáo án buổi lớp GV khác → ownership false (chặn tại loadOwnedSession)", async () => {
    const gv = await makeTeacher("gv6", "CS1");
    const other = await seedUser({
      email: testEmail("gv-other2"),
      role: "TEACHER",
    });
    const s = await seedSession({
      center: "CS1",
      teacherId: other.id,
      withLesson: true,
    });
    const actor = await resolveActorUncached(gv.id);

    const owned = await scopedDb(actor).classSession.findUnique({
      where: { id: s.sessionId },
      select: {
        classId: true,
        substituteTeacherId: true,
        actualTeacherId: true,
        centerId: true,
      },
    });
    expect(
      isSessionOwnedByTeacher(owned!, {
        userId: gv.id,
        assignedClassIds: actor.assignedClassIds,
      }),
    ).toBe(false);
    // → requestLessonChangeAction dừng ở loadOwnedSession, KHÔNG tạo LessonChangeRequest.
    const count = await db.lessonChangeRequest.count();
    expect(count).toBe(0);
  });
});
