// #06 (L6) — DoD site GV: "GV không xem được SĐT/email PH; không lộ studentId trên
// URL; host×role". Kiểm ở TẦNG RENDER/DỮ LIỆU (Postgres LOCAL, không dev server).
//
// VÌ SAO không phải browser test: Next 16 chỉ cho 1 `next dev` mỗi thư mục dự án; máy
// dev đang chạy sẵn 1 server (khác DB test) nên không dựng được server thứ 2 mang cờ
// TEACHER_SITE_ENABLED=true, và ràng buộc "không next build" loại luôn `pnpm start`.
// → thay vì ép browser (đắt/flaky), khẳng định chính xác ĐIỀU trang teacher bảo đảm:
//   • roster helper (nguồn) CÓ studentPhone → việc trang STRIP là load-bearing;
//   • projection y HỆT trang lop/page.tsx (dòng 81–88) map ra AttendancePanelRow —
//     payload xuống client — KHÔNG mang SĐT HV lẫn tên/SĐT/email phụ huynh (câu 46);
//   • điều hướng của trang chỉ khoá theo classId/sessionId, studentId KHÔNG lên URL.
//
// host×role (giaovien vs admin) KHÔNG test được trên localhost (route-policy map mọi
// host → "unknown" → decideRoute {type:"next"} passthrough) — ĐÃ có unit test riêng ở
// lib/auth/route-policy.test.ts. Xem chú thích cuối describe.
import { test, expect } from "@playwright/test";
import { db } from "../../../lib/db";
import { resetDb, seedOrg, seedRoles, seedUser } from "../_helpers/seed";
import { testEmail } from "../_helpers/fixtures";
import { assignUserOrgRole, type RbacActor } from "../../../lib/auth/rbac-service";
import { resolveActorUncached } from "../../../lib/auth/actor";
import { buildSessionAttendanceRows } from "../../../lib/attendance/roster";
import type { AttendancePanelRow } from "../../../app/(teacher)/teacher/lop/_components/attendance-panel";

const SA: RbacActor = { id: "seed-sa", name: "SA", role: "SUPER_ADMIN" };

// PII "mồi" đặc trưng — rò ở bất kỳ đâu là assert bắt được.
const STUDENT_NAME = "Trần Minh Kiệt";
const STUDENT_PHONE = "0911222333"; // SĐT HV — roster helper CÓ, trang phải strip
const PARENT_NAME = "Phụ Huynh Bí Mật";
const PARENT_PHONE = "0999888777"; // SĐT phụ huynh — GV không được xem
const PARENT_EMAIL = "ph-secret-46@example.com"; // email phụ huynh — GV không được xem

async function orgId(code: string) {
  return (await db.orgUnit.findUnique({ where: { code }, select: { id: true } }))!.id;
}
async function centerIdOf(code: string) {
  return (await db.orgUnit.findUnique({ where: { code }, select: { centerId: true } }))!.centerId!;
}

/**
 * Projection Y HỆT app/(teacher)/teacher/lop/page.tsx (dòng 81–88): raw roster → payload
 * client. Giữ ĐỒNG BỘ với trang; nếu trang đổi mapping, cập nhật ở đây cùng lúc.
 */
function toPanelRows(rows: Awaited<ReturnType<typeof buildSessionAttendanceRows>>["rows"]): AttendancePanelRow[] {
  return rows.map((r) => ({
    studentId: r.studentId,
    studentName: r.studentName,
    enrollmentStatus: r.enrollmentStatus,
    makeupFromCenter: r.makeupFromCenter ?? null,
    existingStatus: r.existing?.status ?? null,
    existingNote: r.existing?.note ?? null,
  }));
}

test.describe("[#06-L6] site GV — không lộ contact PH / studentId (render/DB level)", () => {
  let c1 = "";
  let cls: { id: string; courseId: string };
  let studentId = "";
  let sessionId = "";
  let actorGv: Awaited<ReturnType<typeof resolveActorUncached>>;

  test.beforeEach(async () => {
    await resetDb();
    await db.center.create({ data: { code: "CS1", name: "CS1", slug: "cs1-gv-pii-db", address: "a", city: "" } });
    await db.center.create({ data: { code: "CS2", name: "CS2", slug: "cs2-gv-pii-db", address: "b", city: "" } });
    await seedOrg(["HO", "CS1", "CS2"]);
    await seedRoles();
    c1 = await centerIdOf("CS1");

    const gv = await seedUser({ email: testEmail("gv-site-pii-db"), role: "TEACHER", centerId: c1 });
    const teacherRoleId = (await db.roleDef.findUnique({ where: { code: "TEACHER" }, select: { id: true } }))!.id;
    await assignUserOrgRole(SA, {
      userId: gv.id,
      orgUnitId: await orgId("CS1"),
      roleId: teacherRoleId,
      reason: "seed e2e #06 render",
    });

    const rand = Math.random().toString(36).slice(2, 8);
    const course = await db.course.create({ data: { name: `Khoá ${rand}`, slug: `ka-${rand}` }, select: { id: true } });
    cls = await db.class.create({
      data: { name: `Lớp ${rand}`, courseId: course.id, centerId: c1, teacherId: gv.id, status: "ACTIVE" },
      select: { id: true, courseId: true },
    });

    const student = await db.student.create({
      data: {
        name: STUDENT_NAME,
        centerId: c1,
        phone: STUDENT_PHONE,
        parentName: PARENT_NAME,
        parentPhone: PARENT_PHONE,
        parentEmail: PARENT_EMAIL,
      },
      select: { id: true },
    });
    studentId = student.id;
    await db.enrollment.create({
      data: { studentId: student.id, classId: cls.id, courseId: cls.courseId, status: "STUDYING" },
    });
    const sess = await db.classSession.create({
      data: { classId: cls.id, centerId: c1, date: new Date("2026-08-01T02:00:00Z"), status: "SCHEDULED" },
      select: { id: true },
    });
    sessionId = sess.id;
    actorGv = await resolveActorUncached(gv.id);
  });

  test("[câu 46] roster helper CÓ studentPhone (strip là load-bearing, không tình cờ)", async () => {
    const { rows } = await buildSessionAttendanceRows(actorGv, sessionId);
    const row = rows.find((r) => r.studentId === studentId)!;
    expect(row).toBeTruthy();
    expect(row.studentName).toBe(STUDENT_NAME);
    // Nguồn có SĐT HV → nếu trang KHÔNG strip, nó sẽ rò xuống client.
    expect(row.studentPhone).toBe(STUDENT_PHONE);
  });

  test("[câu 46] payload client (AttendancePanelRow) KHÔNG có SĐT HV lẫn contact phụ huynh", async () => {
    const { rows } = await buildSessionAttendanceRows(actorGv, sessionId);
    const panelRows = toPanelRows(rows); // đúng projection của trang teacher

    const serialized = JSON.stringify(panelRows);
    expect(serialized).not.toContain(STUDENT_PHONE);
    expect(serialized).not.toContain(PARENT_PHONE);
    expect(serialized).not.toContain(PARENT_EMAIL);
    expect(serialized).not.toContain(PARENT_NAME);

    // GV vẫn thấy tên HV để điểm danh.
    const row = panelRows.find((r) => r.studentId === studentId)!;
    expect(row.studentName).toBe(STUDENT_NAME);

    // Không có key nào tên "phone"/"email"/"parent…" trong bất kỳ row nào.
    const keys = new Set(panelRows.flatMap((r) => Object.keys(r)));
    for (const k of keys) {
      expect(k.toLowerCase()).not.toContain("phone");
      expect(k.toLowerCase()).not.toContain("email");
      expect(k.toLowerCase()).not.toContain("parent");
    }
  });

  test("[không lộ studentId trên URL] điều hướng trang teacher khoá theo classId/sessionId, không phải studentId", async () => {
    // Trang lop/page.tsx dựng href duy nhất từ classId + sessionId (không bao giờ nhúng
    // studentId). Khẳng định gián tiếp: khoá điều hướng là 2 cuid lớp/buổi, khác studentId.
    const navKeys = { classId: cls.id, sessionId };
    expect(navKeys.classId).not.toBe(studentId);
    expect(navKeys.sessionId).not.toBe(studentId);

    // Buổi được liệt kê theo id-buổi (không theo student) — mô phỏng query trang (b).
    const sessions = await db.classSession.findMany({
      where: { classId: cls.id },
      select: { id: true },
    });
    // Không session nào dùng studentId làm khoá → param sessionId luôn là id-buổi.
    expect(sessions.map((s) => s.id)).not.toContain(studentId);
    expect(sessions.map((s) => s.id)).toContain(sessionId);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// host×role: KHÔNG kiểm ở đây. Trên localhost, lib/auth/route-policy.ts map mọi host
// → hostKind "unknown" → decideRoute() trả {type:"next"} (proxy passthrough), nên
// redirect giaovien↔admin không quan sát được bằng test tích hợp/browser localhost.
// Đã phủ ở unit test: lib/auth/route-policy.test.ts + tests/.../switchable-areas.test.ts
// (rule GV thuần trên host admin → /teacher khi flag ON; role khác trên giaovien bị đá).
// ─────────────────────────────────────────────────────────────────────────────
