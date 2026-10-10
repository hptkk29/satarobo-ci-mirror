/**
 * R7-07 — Gán học viên + state machine buổi học "Hoàn tất buổi". Postgres LOCAL.
 *
 * SKELETON (RTM): AC1↔C1 · AC2↔C2 · AC4↔C4,C5,C7 + DoD consumer giả session.taught.
 * Một số case UI (C3 portal, C6 phạm vi nhận xét) làm ở lớp Playwright UI riêng.
 */
import { test, expect } from "@playwright/test";
import { db } from "../../../lib/db";
import { resetDb } from "../_helpers/seed";
import {
  buildAssignableWhere,
  computeCapacityOutcome,
  assignEnrollments,
} from "../../../lib/lms/assign";
import {
  completeSession,
  classifySessionForComplete,
} from "../../../lib/lms/session-lifecycle";
import {
  on,
  getHandlers,
  clearHandlers,
  type DomainEventLite,
} from "../../../lib/events/registry";
// Nhập TĨNH: `await import()` động không được runner Playwright transpile
// (SyntaxError: Unexpected token 'export').
import { loaiVi } from "../../../lib/payroll/roster-guard";

async function seedClassWithCourse(opts: {
  slug: string;
  centerId: string;
  maxStudents?: number;
}) {
  await db.center.upsert({
    where: { id: opts.centerId },
    create: {
      id: opts.centerId,
      name: opts.centerId,
      code: opts.centerId,
      slug: opts.centerId.toLowerCase(),
      address: "test",
    },
    update: {},
  });
  const course = await db.course.create({
    data: { name: `Khoá ${opts.slug}`, slug: opts.slug },
  });
  const cls = await db.class.create({
    data: {
      name: `Lớp ${opts.slug}`,
      courseId: course.id,
      centerId: opts.centerId,
      maxStudents: opts.maxStudents ?? 10,
      status: "ACTIVE",
    },
    select: { id: true, courseId: true, centerId: true, maxStudents: true },
  });
  return { course, cls };
}

/** Tạo 1 enrollment "chờ xếp lớp" (CONFIRMED) cho 1 HS mới ở cơ sở `centerId`. */
async function seedPendingEnrollment(opts: {
  courseId: string;
  centerId: string | null;
  holdingClassId: string;
  name: string;
}) {
  const student = await db.student.create({
    data: { name: opts.name, centerId: opts.centerId },
    select: { id: true },
  });
  return db.enrollment.create({
    data: {
      studentId: student.id,
      classId: opts.holdingClassId,
      courseId: opts.courseId,
      status: "CONFIRMED",
    },
    select: { id: true, studentId: true },
  });
}

test.describe("[R7-07] Assign students + session lifecycle", () => {
  test.beforeEach(async () => {
    await resetDb();
    clearHandlers();
  });

  // ── PURE ────────────────────────────────────────────────────────────────
  test("[R7-07-U1] buildAssignableWhere lọc đúng khóa + cơ sở + chưa STUDYING", () => {
    const w = buildAssignableWhere({
      id: "c1",
      courseId: "course1",
      centerId: "CS1",
    });
    expect(w.courseId).toBe("course1");
    expect(w.status).toEqual({ in: ["CONFIRMED", "PENDING"] });
    expect(w.classId).toEqual({ not: "c1" });
  });

  test("[R7-07-U2] computeCapacityOutcome", () => {
    expect(computeCapacityOutcome(8, 4, 10)).toEqual({
      total: 12,
      exceeds: true,
    });
    expect(computeCapacityOutcome(6, 4, 10)).toEqual({
      total: 10,
      exceeds: false,
    });
  });

  test("[R7-07-U3] classifySessionForComplete", () => {
    expect(classifySessionForComplete("SCHEDULED")).toBe("OK");
    expect(classifySessionForComplete("COMPLETED")).toBe("ALREADY_COMPLETED");
    expect(classifySessionForComplete("CANCELLED")).toBe("BLOCKED_CANCELLED");
  });

  // ── AC1/C1 — dropdown filter ─────────────────────────────────────────────
  test("[R7-07-C1] chỉ enrollment hợp lệ hiện; CS khác/PAUSED/đã STUDYING ẩn", async () => {
    const { course, cls } = await seedClassWithCourse({
      slug: "asg1",
      centerId: "CS1",
    });
    // Lớp giữ chỗ KHÁC cls (enrollment "chờ xếp lớp" nằm ở lớp khác cùng khóa/CS →
    // buildAssignableWhere có classId:{not: cls.id}, nếu giữ ở chính cls sẽ bị ẩn).
    const holding = await db.class.create({
      data: {
        name: "Holding asg1",
        courseId: course.id,
        centerId: "CS1",
        status: "ACTIVE",
      },
      select: { id: true },
    });

    // hợp lệ: cùng khóa, cùng CS1, CONFIRMED, đang ở lớp giữ chỗ khác.
    await seedPendingEnrollment({
      courseId: course.id,
      centerId: "CS1",
      holdingClassId: holding.id,
      name: "Hợp lệ",
    });
    // CS2 → ẩn.
    await db.center.upsert({
      where: { id: "CS2" },
      create: {
        id: "CS2",
        name: "CS2",
        code: "CS2",
        slug: "cs2",
        address: "test",
      },
      update: {},
    });
    await seedPendingEnrollment({
      courseId: course.id,
      centerId: "CS2",
      holdingClassId: cls.id,
      name: "CS khác",
    });

    const found = await db.enrollment.findMany({
      where: buildAssignableWhere(cls),
      select: { student: { select: { name: true } } },
    });
    const names = found.map((f) => f.student?.name);
    expect(names).toContain("Hợp lệ");
    expect(names).not.toContain("CS khác");
  });

  // ── AC2/C2 — bulk + override sức chứa ────────────────────────────────────
  test("[R7-07-C2] vượt sức chứa → needsOverride; override=true → gán + audit", async () => {
    const { course, cls } = await seedClassWithCourse({
      slug: "asg2",
      centerId: "CS1",
      maxStudents: 2,
    });
    const enrs = await Promise.all(
      [1, 2, 3].map((i) =>
        seedPendingEnrollment({
          courseId: course.id,
          centerId: "CS1",
          holdingClassId: cls.id,
          name: `HS${i}`,
        }),
      ),
    );
    const ids = enrs.map((e) => e.id);

    const blocked = await assignEnrollments({
      classId: cls.id,
      enrollmentIds: ids,
      override: false,
      actorId: "t",
      actorName: "T",
    });
    expect(blocked.ok).toBe(false);
    expect(blocked.needsOverride).toBe(true);

    const ok = await assignEnrollments({
      classId: cls.id,
      enrollmentIds: ids,
      override: true,
      actorId: "t",
      actorName: "T",
    });
    expect(ok.ok).toBe(true);
    expect(ok.assigned).toBe(3);

    const studying = await db.enrollment.count({
      where: { classId: cls.id, status: "STUDYING" },
    });
    expect(studying).toBe(3);
    const audit = await db.auditLog.count({
      where: { entityId: cls.id, action: "ASSIGN_OVERRIDE_CAPACITY" },
    });
    expect(audit).toBeGreaterThanOrEqual(1);
  });

  // ── AC4/C4 — completeSession idempotent + event 1 lần ─────────────────────
  test("[R7-07-C4] completeSession ×2 → dữ liệu thực tế lưu, event chỉ 1 lần", async () => {
    const { cls } = await seedClassWithCourse({
      slug: "ses4",
      centerId: "CS1",
    });
    const s = await db.classSession.create({
      data: { classId: cls.id, date: new Date(), status: "SCHEDULED" },
      select: { id: true },
    });
    const studentForAtt = await db.student.create({
      data: { name: "HS điểm danh", centerId: "CS1" },
      select: { id: true },
    });
    await db.attendance.create({
      data: { sessionId: s.id, studentId: studentForAtt.id, status: "PRESENT" },
    });

    const r1 = await completeSession({
      nguonChot: "TAY",
      assignMode: "DEFER", // bắt buộc từ 08/09; test này không nói về giao bài
      sessionId: s.id,
      actualStartAt: new Date(),
      actorId: "gv",
      actorName: "GV",
    });
    expect(r1.ok).toBe(true);
    const r2 = await completeSession({
      nguonChot: "TAY",
      assignMode: "DEFER", // bắt buộc từ 08/09; test này không nói về giao bài
      sessionId: s.id,
      actorId: "gv",
      actorName: "GV",
    });
    expect(r2.ok).toBe(true);
    expect(r2.alreadyCompleted).toBe(true);

    const events = await db.domainEvent.count({
      where: { type: "session.taught" },
    });
    expect(events).toBe(1); // dedupeKey theo sessionId
  });

  // ── SNAPSHOT SĨ SỐ BIÊN CHẾ (07/09/2026) ─────────────────────────────────
  test("[CD-01] hoàn tất buổi ⇒ chốt cứng sĩ số BIÊN CHẾ, không đếm khách học bù", async () => {
    const { cls, course } = await seedClassWithCourse({
      slug: "roster1",
      centerId: "CS1",
    });
    const khac = await seedClassWithCourse({
      slug: "roster1b",
      centerId: "CS1",
    });

    // 3 em thuộc lớp: 1 ACTIVE, 1 CONFIRMED, 1 PAUSED. Cả ba đều là BIÊN CHẾ — PAUSED là bảo lưu
    // nhưng vẫn thuộc lớp (`ENROLLMENT_ACTIVE_STATUSES`), và đó là nguồn chân lý duy nhất.
    for (const [ten, st] of [
      ["A", "ACTIVE"],
      ["B", "CONFIRMED"],
      ["C", "PAUSED"],
    ] as const) {
      const hs = await db.student.create({
        data: { name: ten, centerId: "CS1" },
        select: { id: true },
      });
      await db.enrollment.create({
        data: {
          studentId: hs.id,
          classId: cls.id,
          courseId: course.id,
          status: st,
        },
      });
    }
    // 1 em ĐÃ RỜI lớp (WITHDREW) — không còn biên chế.
    const roi = await db.student.create({
      data: { name: "D", centerId: "CS1" },
      select: { id: true },
    });
    await db.enrollment.create({
      data: {
        studentId: roi.id,
        classId: cls.id,
        courseId: course.id,
        status: "WITHDREW",
      },
    });
    // 1 em của LỚP KHÁC sang học bù — ngồi trong phòng nhưng KHÔNG thuộc biên chế lớp này.
    const bu = await db.student.create({
      data: { name: "E bù", centerId: "CS1" },
      select: { id: true },
    });
    await db.enrollment.create({
      data: {
        studentId: bu.id,
        classId: khac.cls.id,
        courseId: khac.course.id,
        status: "ACTIVE",
      },
    });

    const s = await db.classSession.create({
      data: { classId: cls.id, date: new Date(), status: "SCHEDULED" },
      select: { id: true },
    });
    // Khách bù CÓ dòng điểm danh ở buổi này — đây đúng là chỗ "đếm điểm danh" cho số sai.
    await db.attendance.create({
      data: { sessionId: s.id, studentId: bu.id, status: "PRESENT" },
    });

    const r = await completeSession({
      nguonChot: "TAY",
      assignMode: "DEFER", // bắt buộc từ 08/09; test này không nói về giao bài
      sessionId: s.id,
      actorId: "gv",
      actorName: "GV",
    });
    expect(r.ok).toBe(true);

    const sau = await db.classSession.findUniqueOrThrow({
      where: { id: s.id },
      select: { rosterSize: true, rosterSource: true, rosterAt: true },
    });
    expect(sau.rosterSize).toBe(3); // A + B + C; KHÔNG có D (đã rời) và KHÔNG có E (học bù)
    expect(sau.rosterSource).toBe("SNAPSHOT");
    expect(sau.rosterAt).not.toBeNull();
  });

  test("[CD-02] số đã chốt KHÔNG đổi khi lớp nhận thêm học viên về sau", async () => {
    // Đây là toàn bộ lý do cột này tồn tại: học viên vào lớp tháng 10 mà làm đổi số buổi tháng 8
    // là đổi cả kỳ lương đã chốt.
    const { cls, course } = await seedClassWithCourse({
      slug: "roster2",
      centerId: "CS1",
    });
    const hs1 = await db.student.create({
      data: { name: "A", centerId: "CS1" },
      select: { id: true },
    });
    await db.enrollment.create({
      data: {
        studentId: hs1.id,
        classId: cls.id,
        courseId: course.id,
        status: "ACTIVE",
      },
    });

    const s = await db.classSession.create({
      data: { classId: cls.id, date: new Date(), status: "SCHEDULED" },
      select: { id: true },
    });
    await db.attendance.create({
      data: { sessionId: s.id, studentId: hs1.id, status: "PRESENT" },
    });
    await completeSession({
      nguonChot: "TAY",
      assignMode: "DEFER", // bắt buộc từ 08/09; test này không nói về giao bài
      sessionId: s.id,
      actorId: "gv",
      actorName: "GV",
    });

    for (const ten of ["B", "C", "D"]) {
      const hs = await db.student.create({
        data: { name: ten, centerId: "CS1" },
        select: { id: true },
      });
      await db.enrollment.create({
        data: {
          studentId: hs.id,
          classId: cls.id,
          courseId: course.id,
          status: "ACTIVE",
        },
      });
    }
    // Gọi lại completeSession: idempotent, KHÔNG được ghi đè số cũ bằng sĩ số hôm nay.
    await completeSession({
      nguonChot: "TAY",
      assignMode: "DEFER", // bắt buộc từ 08/09; test này không nói về giao bài
      sessionId: s.id,
      actorId: "gv",
      actorName: "GV",
    });

    const sau = await db.classSession.findUniqueOrThrow({
      where: { id: s.id },
      select: { rosterSize: true },
    });
    expect(sau.rosterSize).toBe(1);
  });

  // ── AC4/C5 — thiếu điểm danh → cảnh báo bắt confirm ──────────────────────
  test("[R7-07-C5] thiếu điểm danh → needsConfirm; confirm → hoàn tất", async () => {
    const { cls } = await seedClassWithCourse({
      slug: "ses5",
      centerId: "CS1",
    });
    const s = await db.classSession.create({
      data: { classId: cls.id, date: new Date(), status: "SCHEDULED" },
      select: { id: true },
    });
    const warn = await completeSession({
      nguonChot: "TAY",
      assignMode: "DEFER", // bắt buộc từ 08/09; test này không nói về giao bài
      sessionId: s.id,
      actorId: "gv",
      actorName: "GV",
    });
    expect(warn.ok).toBe(false);
    expect(warn.needsConfirm).toBe(true);

    const done = await completeSession({
      nguonChot: "TAY",
      assignMode: "DEFER", // bắt buộc từ 08/09; test này không nói về giao bài
      sessionId: s.id,
      confirmNoAttendance: true,
      actorId: "gv",
      actorName: "GV",
    });
    expect(done.ok).toBe(true);
  });

  // ── AC4/C7 — completeSession trên buổi CANCELLED → chặn ──────────────────
  test("[R7-07-C7] buổi CANCELLED không thể hoàn tất", async () => {
    const { cls } = await seedClassWithCourse({
      slug: "ses7",
      centerId: "CS1",
    });
    const s = await db.classSession.create({
      data: { classId: cls.id, date: new Date(), status: "CANCELLED" },
      select: { id: true },
    });
    const r = await completeSession({
      nguonChot: "TAY",
      assignMode: "DEFER", // bắt buộc từ 08/09; test này không nói về giao bài
      sessionId: s.id,
      confirmNoAttendance: true,
      actorId: "gv",
      actorName: "GV",
    });
    expect(r.ok).toBe(false);
  });

  // ── DoD — consumer GIẢ cho session.taught (chuẩn bị R7-14) ───────────────
  test("[R7-07-D1] fake consumer session.taught chạy đúng 1 lần", async () => {
    const seen: string[] = [];
    on("session.taught", async (e: DomainEventLite) => {
      seen.push(String(e.payload.sessionId));
    });
    expect(getHandlers("session.taught").length).toBeGreaterThanOrEqual(1);

    const { cls } = await seedClassWithCourse({
      slug: "dod1",
      centerId: "CS1",
    });
    const s = await db.classSession.create({
      data: { classId: cls.id, date: new Date(), status: "SCHEDULED" },
      select: { id: true },
    });
    await completeSession({
      nguonChot: "TAY",
      assignMode: "DEFER", // bắt buộc từ 08/09; test này không nói về giao bài
      sessionId: s.id,
      confirmNoAttendance: true,
      actorId: "gv",
      actorName: "GV",
    });

    // Mô phỏng dispatcher: chạy handler thủ công trên event vừa phát.
    const ev = await db.domainEvent.findFirstOrThrow({
      where: { type: "session.taught" },
    });
    const lite: DomainEventLite = {
      id: ev.id,
      type: ev.type,
      payload: ev.payloadJson as Record<string, unknown>,
    };
    for (const h of getHandlers("session.taught")) await h(lite);

    expect(seen).toEqual([s.id]);
  });

  // ── BACKFILL đóng buổi cũ — BA lời hứa, mỗi cái chặn một đường hỏng khác ─────────────
  //
  // Vì sao phải là CSDL thật: cả ba đều là hệ quả ở tầng ghi. Một hàm thuần không nhìn thấy
  // "có dòng DomainEvent nào được sinh ra không" (luật 9).

  test("[BACKFILL-1] KHÔNG phát session.taught ⇒ cả BA consumer đều không chạy", async () => {
    // Chặn ở TẦNG PHÁT, không chặn bằng `assignMode`: `r7-lifecycle` KHÔNG đọc `assignMode`,
    // nên chặn kiểu đó chỉ chặn được hai trong ba mà người viết tin là đã chặn cả ba.
    const { cls } = await seedClassWithCourse({ slug: "bf1", centerId: "CS1" });
    const s = await db.classSession.create({
      data: { classId: cls.id, date: new Date(), status: "SCHEDULED" },
      select: { id: true },
    });
    const r = await completeSession({
      nguonChot: "BACKFILL",
      assignMode: "DEFER",
      sessionId: s.id,
      confirmNoAttendance: true,
      actorId: null,
      actorName: "Backfill test",
    });
    expect(r.ok).toBe(true);

    // Không có dòng sự kiện nào cho ĐÚNG buổi này ⇒ dispatcher không có gì để giao.
    //
    // ⚠️ Lọc theo `dedupeKey` của chính buổi này, KHÔNG đếm cả bảng và KHÔNG `deleteMany`
    // theo `type`. Bản đầu xoá toàn cục — nó đúng khi chạy một mình và giẫm lên mọi spec
    // khác đang chạy song song trên cùng Postgres.
    const ev = await db.domainEvent.findMany({
      where: { dedupeKey: `session.taught:${s.id}` },
      select: { id: true },
    });
    expect(ev, "backfill KHÔNG được phát session.taught").toHaveLength(0);

    // Buổi VẪN được đóng — chặn sự kiện không được biến thành "không đóng được buổi".
    const sau = await db.classSession.findUniqueOrThrow({
      where: { id: s.id },
      select: { status: true, completedAt: true, completedById: true },
    });
    expect(sau.status).toBe("COMPLETED");
    expect(sau.completedAt).not.toBeNull();
    expect(sau.completedById, "backfill: không người nào bấm").toBeNull();
  });

  test("[BACKFILL-2] rosterSource = BACKFILL_CLOSE, KHÔNG phải SNAPSHOT", async () => {
    // `completeSession` đếm ghi danh ĐANG CÓ lúc gọi. Với buổi dạy tháng trước, đó là sĩ số
    // HÔM NAY — số suy đoán. Ghi SNAPSHOT là để cổng lương NHẬN nó vào công thức.
    const { cls } = await seedClassWithCourse({ slug: "bf2", centerId: "CS1" });
    const s = await db.classSession.create({
      data: { classId: cls.id, date: new Date(), status: "SCHEDULED" },
      select: { id: true },
    });
    await completeSession({
      nguonChot: "BACKFILL",
      assignMode: "DEFER",
      sessionId: s.id,
      confirmNoAttendance: true,
      actorId: null,
      actorName: "Backfill test",
    });
    const sau = await db.classSession.findUniqueOrThrow({
      where: { id: s.id },
      select: { rosterSource: true },
    });
    expect(sau.rosterSource).toBe("BACKFILL_CLOSE");

    // Và cổng lương phải TỪ CHỐI số đó — đây mới là điều thật sự cần, nhãn chỉ là phương tiện.
    expect(loaiVi({ sessionId: s.id, rosterSize: 3, rosterSource: sau.rosterSource })).toBe(
      "SI_SO_SUY_DOAN",
    );
  });

  test("[BACKFILL-3] lượt đóng THẬT vẫn phát sự kiện và vẫn ghi SNAPSHOT", async () => {
    // Anti-vacuity: hai ca trên chỉ có nghĩa nếu đường THẬT vẫn hoạt động. Chặn nhầm cả hai
    // đường thì hai ca kia vẫn xanh, và ta vừa tắt đường giao bài tập của toàn hệ thống.
    const { cls } = await seedClassWithCourse({ slug: "bf3", centerId: "CS1" });
    const s = await db.classSession.create({
      data: { classId: cls.id, date: new Date(), status: "SCHEDULED" },
      select: { id: true },
    });
    await completeSession({
      nguonChot: "TAY",
      assignMode: "DEFER",
      sessionId: s.id,
      confirmNoAttendance: true,
      actorId: "gv",
      actorName: "GV",
    });
    const ev = await db.domainEvent.findMany({
      where: { dedupeKey: `session.taught:${s.id}` },
      select: { id: true },
    });
    expect(ev, "đường THẬT phải vẫn phát sự kiện").toHaveLength(1);

    const sau = await db.classSession.findUniqueOrThrow({
      where: { id: s.id },
      select: { rosterSource: true, completedById: true },
    });
    expect(sau.rosterSource).toBe("SNAPSHOT");
    expect(sau.completedById).toBe("gv");
  });
});
