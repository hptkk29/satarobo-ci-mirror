/**
 * RÀ SOÁT LỚP HỌC — 7 lỗi điểm danh (nhánh feat/ra-soat-lop-hoc). Postgres LOCAL
 * (.env.test), R7_SKIP_WEBSERVER=1.
 *
 * ⚠️ Bundle Playwright STUB `@/lib/auth` → auth() trả null (tests/stubs/auth.ts), nên
 * saveClassAttendanceAction / markAttendance KHÔNG gọi trực tiếp được (dừng ở "Chưa
 * đăng nhập"). Theo đúng pattern attendance-edit.spec.ts: test các KHỐI THUẦN/SERVICE
 * mà 2 action dựa vào:
 *   1. notifyAttendanceForSession — nhãn tiếng Việt cho enum MỚI (fix #1) + notifiedAt
 *      chỉ set khi có kênh thật (fix #5: fallback email / cảnh báo SIMULATED).
 *   2. evaluateAbsenceRisk — vắng 2 buổi liên tiếp ghi bằng enum MỚI → alert (fix #2).
 *   3. getSessionRosterStudentIds — guard SEC-M02 (fix #4: nay markAttendance admin
 *      cũng dùng đúng set này + đúng biểu thức từ chối).
 *   4. cancelPendingMakeupNeed — sửa vắng→có mặt thu hồi MakeupNeed PENDING (fix #6).
 *   5. Gate vnTodayEnd — buổi TƯƠNG LAI bị từ chối (fix #7: cùng công thức server
 *      trong saveClassAttendanceAction; đối chiếu bằng oracle Intl độc lập).
 */
import { test, expect } from "@playwright/test";
import { db } from "../../../lib/db";
import { resetDb, seedOrg, seedRoles, seedUser } from "../_helpers/seed";
import { testEmail } from "../_helpers/fixtures";
import { assignUserOrgRole, type RbacActor } from "../../../lib/auth/rbac-service";
import { resolveActorUncached } from "../../../lib/auth/actor";
import { getSessionRosterStudentIds } from "../../../lib/attendance/roster";
import { notifyAttendanceForSession } from "../../../lib/notify/attendance";
import { evaluateAbsenceRisk } from "../../../lib/risk/service";
import { createMakeupNeed, cancelPendingMakeupNeed } from "../../../lib/makeup/service";
import { attendanceLabel } from "../../../lib/labels";

const SA: RbacActor = { id: "seed-sa", name: "SA", role: "SUPER_ADMIN" };
const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;

// Bản sao ĐÚNG công thức server (app/(teacher)/teacher/lop/_actions.ts + page.tsx +
// hub-sessions-tab.tsx) — được đối chiếu với oracle Intl độc lập ở [ATTFIX-05].
const VN_OFFSET_MS = 7 * 60 * 60 * 1000;
function vnTodayEnd(now = new Date()): Date {
  const vn = new Date(now.getTime() + VN_OFFSET_MS);
  const startUtc =
    Date.UTC(vn.getUTCFullYear(), vn.getUTCMonth(), vn.getUTCDate()) - VN_OFFSET_MS;
  return new Date(startUtc + 24 * 60 * 60 * 1000);
}

async function orgId(code: string) {
  return (await db.orgUnit.findUnique({ where: { code }, select: { id: true } }))!.id;
}
async function centerIdOf(code: string) {
  return (await db.orgUnit.findUnique({ where: { code }, select: { centerId: true } }))!.centerId!;
}
async function makeClass(ctr: string, teacherId: string) {
  const rand = Math.random().toString(36).slice(2, 8);
  const course = await db.course.create({
    data: { name: `Khoá ${rand}`, slug: `kf-${rand}` },
    select: { id: true },
  });
  return db.class.create({
    data: { name: `Lớp ${rand}`, courseId: course.id, centerId: ctr, teacherId, status: "ACTIVE" },
    select: { id: true, courseId: true },
  });
}
async function makeSession(classId: string, ctr: string, date: Date) {
  return db.classSession.create({
    data: { classId, centerId: ctr, date, status: "SCHEDULED" },
    select: { id: true },
  });
}

test.describe("[ATTFIX] 7 lỗi điểm danh — rà soát lớp học", () => {
  let c1 = "", c2 = "";
  let gv1 = { id: "" };
  let gv2 = { id: "" };
  let cls1: { id: string; courseId: string };
  let cls2: { id: string; courseId: string };
  let actorGv1: Awaited<ReturnType<typeof resolveActorUncached>>;

  test.beforeEach(async () => {
    await resetDb();
    await db.center.create({ data: { code: "CS1", name: "CS1", slug: "cs1-fix", address: "a", city: "" } });
    await db.center.create({ data: { code: "CS2", name: "CS2", slug: "cs2-fix", address: "b", city: "" } });
    await seedOrg(["HO", "CS1", "CS2"]);
    await seedRoles();
    c1 = await centerIdOf("CS1");
    c2 = await centerIdOf("CS2");
    gv1 = await seedUser({ email: testEmail("gv1-fix"), role: "TEACHER", centerId: c1 });
    gv2 = await seedUser({ email: testEmail("gv2-fix"), role: "TEACHER", centerId: c2 });
    const teacherRoleId = (await db.roleDef.findUnique({ where: { code: "TEACHER" }, select: { id: true } }))!.id;
    await assignUserOrgRole(SA, { userId: gv1.id, orgUnitId: await orgId("CS1"), roleId: teacherRoleId, reason: "seed" });
    await assignUserOrgRole(SA, { userId: gv2.id, orgUnitId: await orgId("CS2"), roleId: teacherRoleId, reason: "seed" });
    cls1 = await makeClass(c1, gv1.id);
    cls2 = await makeClass(c2, gv2.id);
    actorGv1 = await resolveActorUncached(gv1.id);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Fix #1 — PH nhận nhãn tiếng Việt, không bao giờ nhận chuỗi enum thô.
  // ───────────────────────────────────────────────────────────────────────────
  test("[ATTFIX-01] điểm danh ABSENT_UNEXCUSED → email PH chứa 'Vắng không phép', KHÔNG chứa enum thô; notifiedAt set khi email fallback vào queue", async () => {
    const student = await db.student.create({
      data: {
        name: "Bé Nhãn",
        centerId: c1,
        parentEmail: "ph-nhan@test.satarobo.local",
        parentPhone: "0905111222",
      },
      select: { id: true },
    });
    const s = await makeSession(cls1.id, c1, new Date(Date.now() - DAY));
    const att = await db.attendance.create({
      data: {
        sessionId: s.id,
        studentId: student.id,
        status: "ABSENT_UNEXCUSED",
        makeupStatus: "NEEDS_MAKEUP",
        centerId: c1,
      },
      select: { id: true },
    });

    // Ca này đo nhánh "Zalo CHƯA cấu hình → SKIPPED + fallback email". Trước đây nó
    // dựa vào giả định ngầm là env test không có credential Zalo — giả định đó vỡ
    // ngay khi máy dev có `.env.local` mang token thật (Playwright nạp MỌI spec để
    // liệt kê test trước khi chạy, nên env bị nhiễm từ lúc thu thập, không phải do
    // spec nào chạy trước). Nay ca tự dựng điều kiện của mình thay vì trông chờ môi
    // trường — cùng kỷ luật với ATTFIX-01b ngay dưới.
    const zaloEnvKeys = [
      "ZALO_OA_ACCESS_TOKEN",
      "ZALO_OA_REFRESH_TOKEN",
      "ZALO_APP_ID",
      "ZALO_APP_SECRET",
    ] as const;
    const saved = Object.fromEntries(zaloEnvKeys.map((k) => [k, process.env[k]]));
    for (const k of zaloEnvKeys) delete process.env[k];
    try {
      await notifyAttendanceForSession(s.id);
    } finally {
      for (const k of zaloEnvKeys) {
        if (saved[k] !== undefined) process.env[k] = saved[k];
      }
    }

    const mail = await db.emailQueue.findFirst({
      where: { toEmail: "ph-nhan@test.satarobo.local" },
      select: { bodyText: true },
    });
    expect(mail).not.toBeNull();
    expect(mail!.bodyText ?? "").toContain("Vắng không phép");
    expect(mail!.bodyText ?? "").not.toContain("ABSENT_UNEXCUSED");

    // Fix #5 (chiều thuận): email fallback ĐÃ vào queue → đánh dấu đã thông báo.
    const after = await db.attendance.findUniqueOrThrow({ where: { id: att.id }, select: { notifiedAt: true } });
    expect(after.notifiedAt).not.toBeNull();

    // Phủ đủ 6 enum ở tầng nhãn (map dùng chung notify + UI).
    expect(attendanceLabel("ABSENT_EXCUSED").label).toBe("Vắng có phép");
    expect(attendanceLabel("ABSENT").label).toBe("Vắng không phép");
    expect(attendanceLabel("EXCUSED").label).toBe("Vắng có phép");
    expect(attendanceLabel("PRESENT").label).toBe("Có mặt");
    expect(attendanceLabel("LATE").label).toBe("Đi muộn");
  });

  test("[ATTFIX-01b] có creds nhưng ZALO_LIVE tắt (SIMULATED) → vẫn set notifiedAt (chống gửi lặp) nhưng log SENT mang providerMessageId SIMULATED-", async () => {
    process.env.ZALO_OA_ACCESS_TOKEN = "test-token-simulated";
    try {
      const student = await db.student.create({
        // CHỈ có phone (không email) → không có nhánh fallback, đi thẳng provider.
        data: { name: "Bé Sim", centerId: c1, parentPhone: "0905333444" },
        select: { id: true },
      });
      const s = await makeSession(cls1.id, c1, new Date(Date.now() - DAY));
      const att = await db.attendance.create({
        data: { sessionId: s.id, studentId: student.id, status: "ABSENT_UNEXCUSED", centerId: c1 },
        select: { id: true },
      });

      await notifyAttendanceForSession(s.id);

      const log = await db.zaloMessageLog.findFirst({
        where: { toPhone: "0905333444" },
        select: { status: true, providerMessageId: true },
      });
      expect(log?.status).toBe("SENT");
      expect(log?.providerMessageId ?? "").toContain("SIMULATED-");

      // Lựa chọn fix #5: SIMULATED vẫn đánh dấu (tránh vòng gửi lặp mỗi lần lưu
      // trên env test — nơi ZNS luôn SIMULATED) + console.warn rõ trong service.
      const after = await db.attendance.findUniqueOrThrow({ where: { id: att.id }, select: { notifiedAt: true } });
      expect(after.notifiedAt).not.toBeNull();
    } finally {
      delete process.env.ZALO_OA_ACCESS_TOKEN;
    }
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Fix #2 — vắng 2 buổi liên tiếp bằng enum MỚI → StudentRiskAlert.
  // ───────────────────────────────────────────────────────────────────────────
  test("[ATTFIX-02] 2 buổi liên tiếp ABSENT_UNEXCUSED (enum mới, đường site GV) → alert CONSECUTIVE_ABSENCE", async () => {
    const student = await db.student.create({
      data: { name: "Bé Rủi Ro", centerId: c1 },
      select: { id: true },
    });
    const s1 = await makeSession(cls1.id, c1, new Date(Date.now() - 3 * DAY));
    const s2 = await makeSession(cls1.id, c1, new Date(Date.now() - 1 * DAY));
    for (const sid of [s1.id, s2.id]) {
      await db.attendance.create({
        data: { sessionId: sid, studentId: student.id, status: "ABSENT_UNEXCUSED", makeupStatus: "NEEDS_MAKEUP", centerId: c1 },
      });
    }

    await evaluateAbsenceRisk(student.id, cls1.id);

    const alert = await db.studentRiskAlert.findFirst({
      where: { studentId: student.id, type: "CONSECUTIVE_ABSENCE", status: "OPEN" },
      select: { id: true, severity: true },
    });
    expect(alert).not.toBeNull();
    expect(alert!.severity).toBe("HIGH");
  });

  test("[ATTFIX-02b] buổi gần nhất CÓ MẶT → không alert (không dương tính giả)", async () => {
    const student = await db.student.create({
      data: { name: "Bé Bình Thường", centerId: c1 },
      select: { id: true },
    });
    const s1 = await makeSession(cls1.id, c1, new Date(Date.now() - 3 * DAY));
    const s2 = await makeSession(cls1.id, c1, new Date(Date.now() - 1 * DAY));
    await db.attendance.create({
      data: { sessionId: s1.id, studentId: student.id, status: "ABSENT_UNEXCUSED", centerId: c1 },
    });
    await db.attendance.create({
      data: { sessionId: s2.id, studentId: student.id, status: "PRESENT", centerId: c1 },
    });

    await evaluateAbsenceRisk(student.id, cls1.id);

    expect(
      await db.studentRiskAlert.count({ where: { studentId: student.id } }),
    ).toBe(0);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Fix #4 — guard roster SEC-M02: markAttendance admin nay dùng CÙNG set + CÙNG
  // biểu thức từ chối với saveClassAttendanceAction (action gọi auth() → không
  // invoke trực tiếp được trong runner này; test đúng tầng guard).
  // ───────────────────────────────────────────────────────────────────────────
  test("[ATTFIX-03] studentId NGOÀI roster → biểu thức guard của cả 2 action từ chối", async () => {
    const insider = await db.student.create({
      data: { name: "HV Trong Lớp", centerId: c1 },
      select: { id: true },
    });
    await db.enrollment.create({
      data: { studentId: insider.id, classId: cls1.id, courseId: cls1.courseId, status: "STUDYING", centerId: c1 },
    });
    // HV cơ sở KHÁC, không ghi danh lớp này, không học bù buổi này.
    const outsider = await db.student.create({
      data: { name: "HV Cơ Sở Khác", centerId: c2 },
      select: { id: true },
    });
    await db.enrollment.create({
      data: { studentId: outsider.id, classId: cls2.id, courseId: cls2.courseId, status: "STUDYING", centerId: c2 },
    });
    const s = await makeSession(cls1.id, c1, new Date(Date.now() - DAY));

    const rosterIds = await getSessionRosterStudentIds(actorGv1, s.id);
    expect(rosterIds.has(insider.id)).toBe(true);
    expect(rosterIds.has(outsider.id)).toBe(false);

    // Đúng biểu thức trong saveClassAttendanceAction (SEC-M02 cũ) VÀ markAttendance
    // admin (mới thêm): có 1 studentId ngoài roster ⇒ từ chối cả lô.
    const payload = [{ studentId: insider.id }, { studentId: outsider.id }];
    expect(payload.some((r) => !rosterIds.has(r.studentId))).toBe(true);

    // Lô hợp lệ (chỉ HV trong roster) ⇒ đi qua.
    expect([{ studentId: insider.id }].some((r) => !rosterIds.has(r.studentId))).toBe(false);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Fix #6 — sửa vắng → có mặt: thu hồi MakeupNeed PENDING.
  // ───────────────────────────────────────────────────────────────────────────
  test("[ATTFIX-04] cancelPendingMakeupNeed huỷ PENDING của (HV, buổi lỡ); idempotent; KHÔNG đụng SCHEDULED", async () => {
    const student = await db.student.create({
      data: { name: "Bé Học Bù", centerId: c1 },
      select: { id: true },
    });
    const missed = await makeSession(cls1.id, c1, new Date(Date.now() - DAY));

    const created = await createMakeupNeed({ studentId: student.id, missedSessionId: missed.id });
    expect(created.ok).toBe(true);
    expect(
      (await db.makeupNeed.findUniqueOrThrow({ where: { id: created.id! }, select: { status: true } })).status,
    ).toBe("PENDING");

    // Sửa vắng → PRESENT (đường action gọi helper này) → PENDING bị huỷ.
    const first = await cancelPendingMakeupNeed({ studentId: student.id, missedSessionId: missed.id });
    expect(first.cancelled).toBe(1);
    expect(
      (await db.makeupNeed.findUniqueOrThrow({ where: { id: created.id! }, select: { status: true } })).status,
    ).toBe("CANCELLED");

    // Idempotent: gọi lại không lỗi, không đổi gì.
    expect((await cancelPendingMakeupNeed({ studentId: student.id, missedSessionId: missed.id })).cancelled).toBe(0);

    // Nhu cầu ĐÃ SCHEDULED (đã hẹn PH buổi bù) → KHÔNG bị tự huỷ sau lưng.
    const student2 = await db.student.create({
      data: { name: "Bé Đã Xếp Bù", centerId: c1 },
      select: { id: true },
    });
    const missed2 = await makeSession(cls1.id, c1, new Date(Date.now() - 2 * DAY));
    const scheduled = await db.makeupNeed.create({
      data: {
        studentId: student2.id,
        classId: cls1.id,
        centerId: c1,
        missedSessionId: missed2.id,
        status: "SCHEDULED",
      },
      select: { id: true },
    });
    expect((await cancelPendingMakeupNeed({ studentId: student2.id, missedSessionId: missed2.id })).cancelled).toBe(0);
    expect(
      (await db.makeupNeed.findUniqueOrThrow({ where: { id: scheduled.id }, select: { status: true } })).status,
    ).toBe("SCHEDULED");
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 19/08 — HỒI SINH nhu cầu đã thu hồi. Khoá unique (studentId, missedSessionId) nên
  // row không bao giờ bị xoá; nhánh `update` của upsert trước đây chỉ ghi `note`, nên
  // chuỗi "vắng → sửa nhầm có mặt → sửa lại vắng" để MakeupNeed kẹt ở CANCELLED trong
  // khi Attendance.makeupStatus = NEEDS_MAKEUP ⇒ HV biến mất khỏi /admin/hoc-bu.
  // ───────────────────────────────────────────────────────────────────────────
  test("[ATTFIX-04b] createMakeupNeed hồi sinh CANCELLED → PENDING; KHÔNG đụng SCHEDULED/COMPLETED", async () => {
    const student = await db.student.create({
      data: { name: "Bé Vắng Lại", centerId: c1 },
      select: { id: true },
    });
    const missed = await makeSession(cls1.id, c1, new Date(Date.now() - DAY));

    const created = await createMakeupNeed({ studentId: student.id, missedSessionId: missed.id });
    expect(created.ok).toBe(true);
    await cancelPendingMakeupNeed({ studentId: student.id, missedSessionId: missed.id });

    // Không bật cờ → KHÔNG hồi sinh (giữ nguyên quyết định huỷ của quản lý ở /admin/hoc-bu).
    await createMakeupNeed({ studentId: student.id, missedSessionId: missed.id });
    expect(
      (await db.makeupNeed.findUniqueOrThrow({ where: { id: created.id! }, select: { status: true } })).status,
    ).toBe("CANCELLED");

    // Đánh vắng lại (chuyển trạng thái thật) → nhu cầu sống lại, KHÔNG tạo row thứ hai.
    const again = await createMakeupNeed({
      studentId: student.id,
      missedSessionId: missed.id,
      reviveCancelled: true,
    });
    expect(again.ok).toBe(true);
    expect(again.id).toBe(created.id);
    expect(
      (await db.makeupNeed.findUniqueOrThrow({ where: { id: created.id! }, select: { status: true } })).status,
    ).toBe("PENDING");
    expect(
      await db.makeupNeed.count({ where: { studentId: student.id, missedSessionId: missed.id } }),
    ).toBe(1);

    // Nhu cầu ĐÃ XẾP BUỔI BÙ: giữ nguyên, không bị kéo về PENDING sau lưng người xếp lịch.
    const student2 = await db.student.create({
      data: { name: "Bé Đã Hẹn Bù", centerId: c1 },
      select: { id: true },
    });
    const missed2 = await makeSession(cls1.id, c1, new Date(Date.now() - 3 * DAY));
    const scheduled2 = await db.makeupNeed.create({
      data: {
        studentId: student2.id,
        classId: cls1.id,
        centerId: c1,
        missedSessionId: missed2.id,
        status: "SCHEDULED",
      },
      select: { id: true },
    });
    await createMakeupNeed({
      studentId: student2.id,
      missedSessionId: missed2.id,
      reviveCancelled: true,
    });
    expect(
      (await db.makeupNeed.findUniqueOrThrow({ where: { id: scheduled2.id }, select: { status: true } })).status,
    ).toBe("SCHEDULED");
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Fix #7 — buổi TƯƠNG LAI: gate vnTodayEnd (server chốt trong
  // saveClassAttendanceAction; action cần auth() nên kiểm công thức + ngữ nghĩa
  // bằng oracle Intl độc lập).
  // ───────────────────────────────────────────────────────────────────────────
  test("[ATTFIX-05] buổi NGÀY MAI bị từ chối, buổi hôm nay/quá khứ được phép (gate vnTodayEnd)", async () => {
    // Oracle độc lập: lấy ngày VN qua Intl (timeZone Asia/Ho_Chi_Minh), suy mốc hết
    // ngày = 00:00 VN ngày mai. Phải TRÙNG công thức VN_OFFSET_MS của server.
    const now = new Date();
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Ho_Chi_Minh",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(now); // "YYYY-MM-DD"
    const [y, m, d] = parts.split("-").map(Number);
    const oracleEnd = new Date(Date.UTC(y!, m! - 1, d! + 1) - VN_OFFSET_MS);
    expect(vnTodayEnd(now).getTime()).toBe(oracleEnd.getTime());

    const todayEnd = vnTodayEnd();
    // Buổi 02:00 VN NGÀY MAI → server từ chối (date > todayEnd).
    const tomorrow = await makeSession(cls1.id, c1, new Date(todayEnd.getTime() + 2 * HOUR));
    // Buổi 22:00 VN HÔM NAY và buổi hôm qua → được phép.
    const today = await makeSession(cls1.id, c1, new Date(todayEnd.getTime() - 2 * HOUR));
    const yesterday = await makeSession(cls1.id, c1, new Date(todayEnd.getTime() - DAY - 2 * HOUR));

    const rejectsFuture = (date: Date) => date.getTime() > todayEnd.getTime();

    const sTomorrow = await db.classSession.findUniqueOrThrow({ where: { id: tomorrow.id }, select: { date: true } });
    const sToday = await db.classSession.findUniqueOrThrow({ where: { id: today.id }, select: { date: true } });
    const sYesterday = await db.classSession.findUniqueOrThrow({ where: { id: yesterday.id }, select: { date: true } });

    expect(rejectsFuture(sTomorrow.date)).toBe(true); // "Buổi học chưa diễn ra — không thể điểm danh trước"
    expect(rejectsFuture(sToday.date)).toBe(false);
    expect(rejectsFuture(sYesterday.date)).toBe(false);
  });
});
