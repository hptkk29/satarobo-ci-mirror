// [E2E-HB-RASOAT-01..02] — màn "Rà soát dữ liệu Học bù" (/admin/hoc-bu/ra-soat) qua TRÌNH DUYỆT THẬT, DB local.
//   01  Quản lý cơ sở (có makeup:view-all) mở màn, bấm "Chạy rà soát" ⇒ thấy phát hiện dựng tay (TV-03) + liên kết; màn KHÔNG có nút tự sửa.
//   02  Sale (không có makeup:view-all) KHÔNG vào được màn (bị chuyển đi) — đối chứng dương: quản lý cơ sở vào được ở ca 01; và Sale không thấy lối vào ở /hoc-bu.
// Mọi ca vắng mặt chờ marker dương đã định hình (trang có loading.tsx trả 200 + khung chờ trước khi redirect/notFound chạy).
import { test, expect } from "@playwright/test";
import { db } from "../../../lib/db";
import { resetDb, seedOrg, seedRoles, seedUser } from "../_helpers/seed";
import { testEmail } from "../_helpers/fixtures";
import { login } from "../_helpers/auth";
import { assignUserOrgRole, type RbacActor } from "../../../lib/auth/rbac-service";

const SA: RbacActor = { id: "seed-sa", name: "SA", role: "SUPER_ADMIN" };
const email = { ql: testEmail("hb-rs-ql"), sale: testEmail("hb-rs-sale") };
let needId = "";

async function gan(userId: string, roleCode: string, orgCode: string) {
  const roleId = (await db.roleDef.findUnique({ where: { code: roleCode }, select: { id: true } }))!.id;
  const orgUnitId = (await db.orgUnit.findUnique({ where: { code: orgCode }, select: { id: true } }))!.id;
  await assignUserOrgRole(SA, { userId, orgUnitId, roleId, reason: "seed e2e ra-soat hoc-bu" });
}

test.describe.configure({ mode: "serial" });

test.describe("[E2E-HB-RASOAT] màn Rà soát dữ liệu Học bù (chỉ đọc)", () => {
  test.beforeAll(async () => {
    await resetDb();
    await db.center.upsert({ where: { code: "CS1" }, create: { code: "CS1", name: "CS1", slug: "cs1-hb-rs", address: "a", city: "" }, update: {} });
    await seedOrg(["HO", "CS1"]);
    await seedRoles();
    const cs1 = (await db.orgUnit.findUnique({ where: { code: "CS1" }, select: { centerId: true } }))!.centerId!;
    const ql = await seedUser({ email: email.ql, role: "CENTER_MANAGER", centerId: cs1 });
    await gan(ql.id, "CENTER_MANAGER", "CS1");
    const sale = await seedUser({ email: email.sale, role: "SALES_CSM", centerId: cs1 });
    await gan(sale.id, "CENTER_SALES_CSM", "CS1");

    const rand = Math.random().toString(36).slice(2, 8);
    const khoa = await db.course.create({ data: { name: `Khoá RS ${rand}`, slug: `rs-${rand}`, totalSessions: 12, price: 12_000_000 } });
    const cur = await db.curriculum.create({ data: { courseId: khoa.id, name: `GT RS ${rand}` } });
    const bai = await db.lesson.create({ data: { curriculumId: cur.id, order: 1, title: "Bài một", moduleCode: "RS1" } });
    const lop = await db.class.create({ data: { name: `Lớp RS ${rand}`, courseId: khoa.id, centerId: cs1, status: "ACTIVE", startTime: "18:00", endTime: "19:30" } });
    const be = await db.student.create({ data: { name: `Bé Rà Soát ${rand}`, centerId: cs1 } });
    await db.enrollment.create({ data: { studentId: be.id, classId: lop.id, courseId: khoa.id, status: "ACTIVE", saleId: sale.id } });
    const buoi = await db.classSession.create({ data: { classId: lop.id, centerId: cs1, date: new Date("2026-10-05T11:00:00.000Z"), lessonId: bai.id, status: "COMPLETED" } });
    const dd = await db.attendance.create({ data: { sessionId: buoi.id, studentId: be.id, status: "ABSENT_EXCUSED", makeupStatus: "NEEDS_MAKEUP", absenceReason: "Con ốm", centerId: cs1 } });
    // Dữ liệu hỏng dựng tay: dòng cần bù thiếu bài mà buổi gốc có bài ⇒ TV-03 (AUTO_FIXABLE).
    const need = await db.makeupNeed.create({
      data: {
        studentId: be.id, classId: lop.id, centerId: cs1, courseId: khoa.id, sourceType: "ABSENCE", originalAttendanceId: dd.id,
        missedSessionId: buoi.id, missedLessonId: null, status: "PENDING", createdAt: new Date("2026-10-06T00:00:00.000Z"),
      },
    });
    needId = need.id;
  });

  test.afterAll(async () => {
    await db.$disconnect();
  });

  test("[E2E-HB-RASOAT-01] quản lý cơ sở mở màn, bấm 'Chạy rà soát' ⇒ thấy TV-03 dựng tay kèm liên kết; không có nút tự sửa; không ghi gì", async ({ page }) => {
    await login(page, { email: email.ql, callbackUrl: "/admin/hoc-bu", timeout: 90_000 });
    await page.goto("/admin/hoc-bu/ra-soat", { waitUntil: "domcontentloaded" });
    const chay = page.getByRole("link", { name: "Chạy rà soát" });
    await expect(chay).toBeVisible({ timeout: 60_000 });
    const truoc = await db.makeupNeed.findUniqueOrThrow({ where: { id: needId }, select: { updatedAt: true, missedLessonId: true } });

    await chay.click();
    await expect(page.getByRole("heading", { name: /TV-03/ })).toBeVisible({ timeout: 60_000 });
    await expect(page.getByText("Có thể sửa tự động (script)").first()).toBeVisible();
    await expect(page.getByRole("link", { name: /Màn Học bù/ }).first()).toBeVisible();
    // Không một nút tự sửa nào trên màn (chỉ liên kết).
    await expect(page.getByRole("button", { name: /sửa|áp dụng|chạy sửa|fix/i })).toHaveCount(0);

    const sau = await db.makeupNeed.findUniqueOrThrow({ where: { id: needId }, select: { updatedAt: true, missedLessonId: true } });
    expect(sau).toEqual(truoc);
  });

  test("[E2E-HB-RASOAT-02] Sale KHÔNG vào được màn (bị chuyển đi) và không thấy lối vào ở /hoc-bu", async ({ page }) => {
    await login(page, { email: email.sale, callbackUrl: "/admin/hoc-bu", timeout: 90_000 });
    // Đối chứng dương trước: Sale vào được /hoc-bu và màn đã định hình (có tiêu đề Học bù) — nhưng KHÔNG có nút "Rà soát dữ liệu".
    await page.goto("/admin/hoc-bu", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: /Học bù/ }).first()).toBeVisible({ timeout: 60_000 });
    await expect(page.getByRole("link", { name: "Rà soát dữ liệu" })).toHaveCount(0);

    await page.goto("/admin/hoc-bu/ra-soat", { waitUntil: "domcontentloaded" }).catch(() => undefined);
    await expect.poll(() => page.url(), { timeout: 60_000 }).not.toContain("/hoc-bu/ra-soat");
    await expect(page.getByRole("link", { name: "Chạy rà soát" })).toHaveCount(0);
  });
});
