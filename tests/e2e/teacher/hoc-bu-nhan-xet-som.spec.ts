// [E2E-HB-NXS-01..06] — nhận xét Học bù ở site giáo viên, đồng bộ lớp chính, qua TRÌNH DUYỆT THẬT (login thật, Postgres LOCAL).
//
// Chủ dự án: "thừa ô nhận xét chung, còn nút nhận xét thì cho hiện ra luôn, không hiện sau điểm danh nữa".
//   NXS-01  nút "Nhận xét" hiện NGAY khi mục còn chờ điểm danh; KHÔNG còn ô "Nhận xét chung"; hộp thoại có Dự án + Đánh giá chung + đủ 9 tiêu chí
//   NXS-02  lưu phiếu TRƯỚC điểm danh; tải lại trang phiếu vẫn còn (nút đổi thành "Xem phiếu", mở ra đúng chữ đã lưu)
//   NXS-03  phụ huynh KHÔNG thấy phiếu nháp khi buổi chưa có kết quả (đối chứng dương: vẫn thấy lớp/bé của mình ⇒ trang đã nạp xong)
//   NXS-04  điểm danh xong ("Đã học xong" + "Có mặt — lưu kết quả") KHÔNG xoá / ghi đè phiếu; nhận xét chung CŨ đã lưu từ trước được giữ và hiện để đọc
//   NXS-05  phụ huynh thấy đúng phiếu SAU khi mục có kết quả (đối chứng dương của NXS-03)
//   NXS-06  mục đã gỡ (bé vắng) không còn nút Nhận xét
//
// ⚠️ Ca "KHÔNG thấy X" đi kèm đối chứng dương (CLAUDE.md luật 11) — NXS-03 chỉ có nghĩa vì NXS-05 chứng minh chính chuỗi đó THẤY được khi đáng thấy.
import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { db } from "../../../lib/db";
import { resetDb, seedOrg, seedRoles, seedUser } from "../_helpers/seed";
import { testEmail } from "../_helpers/fixtures";
import { login } from "../_helpers/auth";
import { assignUserOrgRole, type RbacActor } from "../../../lib/auth/rbac-service";
import { taoCaseVaXep } from "../../../lib/hoc-bu/case-db";
import type { NguoiHocBu } from "../../../lib/hoc-bu/pham-vi";
import { EVAL_CRITERIA } from "../../../lib/lms/session-eval-rubric";
import { vnYmd } from "../../../lib/time/vn";

// Chi tiết đánh giá ở cổng phụ huynh CHỈ có khi cổng v2 bật (`isPortalV2Enabled`, mặc định OFF; PROD đang ON). Chạy: PORTAL_V2_ENABLED=true pnpm exec playwright test -c playwright.teacher.config.ts …
// Khi cờ không bật, hai ca phía phụ huynh tự BỎ QUA (có lý do) thay vì "xanh rỗng": cổng cũ không hiện chi tiết nên "không thấy phiếu nháp" luôn đúng.
const COT_V2 = process.env.PORTAL_V2_ENABLED === "true";
const SA: RbacActor = { id: "seed-sa", name: "SA", role: "SUPER_ADMIN" };
const TEN_BE = "Bé Phiếu Sớm";
const LOP = "Lớp Phiếu Sớm";
const PHIEU = "Con tập trung tốt, lắp đúng mẫu và biết giải thích cách làm — phiếu viết sớm";
const CU = "Nhận xét chung cũ đã lưu từ trước";
const ids = { cs1: "", khoa: "", gv: "", ph: "", be: "", caseId: "", mucId: "", partId: "", adminId: "" };
const email = { gv: testEmail("nxs-gv"), ph: testEmail("nxs-ph") };

async function gan(userId: string, roleCode: string, orgCode: string) {
  const roleId = (await db.roleDef.findUnique({ where: { code: roleCode }, select: { id: true } }))!.id;
  const orgUnitId = (await db.orgUnit.findUnique({ where: { code: orgCode }, select: { id: true } }))!.id;
  await assignUserOrgRole(SA, { userId, orgUnitId, roleId, reason: "seed e2e nhan xet som" });
}
const adminHocBu = () =>
  ({ userId: ids.adminId, isSuperAdmin: true, isHoLevel: true, orgRoles: [], permissions: [], visibleCenterIds: [], visibleOrgUnitIds: [], grantsAllow: new Set<string>(), assignedClassIds: new Set<string>(), chiCuaSale: null }) as unknown as NguoiHocBu;

test.describe.configure({ mode: "serial" });

test.describe("[E2E-HB-NXS] nhận xét Học bù đồng bộ lớp chính (trình duyệt thật)", () => {
  test.beforeAll(async () => {
    await resetDb();
    await db.center.upsert({ where: { code: "CS1" }, create: { code: "CS1", name: "CS1", slug: "cs1-nxs", address: "a", city: "" }, update: {} });
    await seedOrg(["HO", "CS1"]);
    await seedRoles();
    ids.cs1 = (await db.orgUnit.findUnique({ where: { code: "CS1" }, select: { centerId: true } }))!.centerId!;
    const admin = await seedUser({ email: testEmail("nxs-admin"), role: "SUPER_ADMIN" });
    ids.adminId = admin.id;
    const gv = await seedUser({ email: email.gv, role: "TEACHER", centerId: ids.cs1 });
    ids.gv = gv.id;
    await gan(gv.id, "TEACHER", "CS1");
    const ph = await seedUser({ email: email.ph, role: "PARENT" });
    ids.ph = ph.id;

    const rand = Math.random().toString(36).slice(2, 8);
    const khoa = await db.course.create({ data: { name: `Khoá NXS ${rand}`, slug: `nxs-${rand}`, totalSessions: 12, price: 12_000_000 } });
    ids.khoa = khoa.id;
    const cur = await db.curriculum.create({ data: { courseId: khoa.id, name: `GT NXS ${rand}` } });
    const bai = await db.lesson.create({ data: { curriculumId: cur.id, order: 1, title: "Bài một", moduleCode: "NXS1" } });
    const lop = await db.class.create({ data: { name: LOP, courseId: khoa.id, centerId: ids.cs1, teacherId: gv.id, status: "ACTIVE", startTime: "18:00", endTime: "19:30" } });
    const phong = await db.room.create({ data: { code: `nxs-p-${rand}`, name: "Phòng NXS", centerId: ids.cs1 } });
    const be = await db.student.create({ data: { name: TEN_BE, centerId: ids.cs1, parentUserId: ph.id, parentName: "PH NXS", parentPhone: "0900000033" } });
    ids.be = be.id;
    await db.enrollment.create({ data: { studentId: be.id, classId: lop.id, courseId: khoa.id, status: "ACTIVE" } });
    const tk = await db.makeupCreditAccount.create({ data: { studentId: be.id, courseId: khoa.id, granted: 3 } });
    await db.makeupCreditEntry.create({ data: { accountId: tk.id, type: "GRANT", grantedDelta: 3, reason: "Mở sổ e2e", idemKey: "GRANT:khoi-tao" } });
    const buoi = await db.classSession.create({ data: { classId: lop.id, centerId: ids.cs1, date: new Date("2026-10-05T11:00:00.000Z"), lessonId: bai.id, status: "COMPLETED" } });
    const dd = await db.attendance.create({ data: { sessionId: buoi.id, studentId: be.id, status: "ABSENT_EXCUSED", makeupStatus: "NEEDS_MAKEUP", absenceReason: "Con ốm", centerId: ids.cs1 } });
    const need = await db.makeupNeed.create({
      data: { studentId: be.id, classId: lop.id, centerId: ids.cs1, courseId: khoa.id, sourceType: "ABSENCE", originalAttendanceId: dd.id, missedSessionId: buoi.id, missedLessonId: bai.id, status: "PENDING", createdAt: new Date("2026-10-06T00:00:00.000Z") },
    });

    // Ca làm cả ngày HÔM NAY cho giáo viên (lõi xếp lịch đòi ca phủ khung giờ bù) — fixture của e2e, ghi trực tiếp trên DB test local như `hoc-bu-theo-vai.spec.ts`.
    const homNay = vnYmd(new Date());
    const mau = await db.shiftTemplate.create({ data: { code: `NXS-${rand}`, name: "Ca NXS", kind: "TIMED", segments: [{ start: "00:00", end: "23:59", kind: "WORK" }] } });
    await db.shiftAssignment.create({
      data: { userId: gv.id, centerId: ids.cs1, workDate: new Date(`${homNay}T00:00:00.000Z`), templateId: mau.id, templateCode: `NXS-${rand}`, segments: [{ start: "00:00", end: "23:59", kind: "WORK" }], placeMode: "AT_UNITS", attendanceMode: "NONE", dayCredit: 0, source: "MANUAL" },
    });
    ids.caseId = await taoCaseVaXep(adminHocBu(), { ymd: homNay, startTime: "00:10", endTime: "01:40", roomId: phong.id, teacherId: gv.id, note: null, needIds: [need.id] });
    ids.mucId = (await db.makeupCaseStudent.findFirstOrThrow({ where: { caseId: ids.caseId, makeupNeedId: need.id } })).id;
    ids.partId = (await db.makeupCaseParticipant.findFirstOrThrow({ where: { caseId: ids.caseId, studentId: be.id } })).id;
  });
  test.afterAll(async () => {
    await db.$disconnect();
  });

  const dangNhap = (page: Page, mail: string, callbackUrl: string) => login(page, { email: mail, callbackUrl, timeout: 90_000 });
  const doiNguoi = async (page: Page, context: BrowserContext) => {
    await page.goto("about:blank"); // rời trang TRƯỚC khi xoá cookie (xem ghi chú ở hoc-bu-theo-vai.spec.ts: clearCookies trần là cuộc đua)
    await context.clearCookies();
  };
  const moCase = async (page: Page) => {
    await page.goto(`/teacher/hoc-bu/${ids.caseId}`, { waitUntil: "domcontentloaded" });
    await expect(page.getByText(TEN_BE).first()).toBeVisible({ timeout: 60_000 });
  };
  const muc = () => db.makeupCaseStudent.findUniqueOrThrow({ where: { id: ids.mucId } });
  /**
   * Bấm nút mở hộp thoại phiếu và chờ hộp THẬT SỰ mở. Sau `reload` nút đã hiện (HTML từ máy chủ) trước khi React hydrate, một cú bấm lúc đó bị nuốt — thử lại tới khi
   * hộp mở thay vì tăng trần chờ (đo 13/10: ca NXS-02 đỏ chập chờn đúng ở bước "Xem phiếu" sau reload).
   */
  const moHop = async (page: Page, ten: RegExp) => {
    await expect(async () => {
      await page.getByRole("button", { name: ten }).click();
      await expect(page.getByRole("dialog")).toBeVisible({ timeout: 4_000 });
    }).toPass({ timeout: 45_000 });
  };

  test("[E2E-HB-NXS-01] nút 'Nhận xét' hiện NGAY khi chưa điểm danh; không còn ô 'Nhận xét chung'; hộp thoại có Dự án, Đánh giá chung và đủ 9 tiêu chí", async ({ page }) => {
    await dangNhap(page, email.gv, "/teacher/hoc-bu");
    await moCase(page);
    // Chưa điểm danh: form chọn kết quả còn đó VÀ nút Nhận xét đã hiện (trước đây nút chỉ hiện sau điểm danh).
    await expect(page.getByRole("button", { name: "Đã học xong" })).toBeVisible();
    await expect(page.getByRole("button", { name: /^Nhận xét$/ })).toBeVisible();
    // Đồng bộ lớp chính: KHÔNG còn ô / nút "Nhận xét chung về buổi học".
    await expect(page.getByLabel("Nhận xét chung")).toHaveCount(0);
    await expect(page.getByText(/Nhận xét chung về buổi học/)).toHaveCount(0);
    await moHop(page, /^Nhận xét$/);
    const hop = page.getByRole("dialog");
    await expect(hop.getByText("Nhận xét buổi học")).toBeVisible();
    await expect(hop.getByText("Dự án", { exact: true }).first()).toBeVisible();
    await expect(hop.getByText("Đánh giá chung").first()).toBeVisible();
    await expect(hop.locator("select")).toHaveCount(EVAL_CRITERIA.length); // 9 tiêu chí
    for (const c of EVAL_CRITERIA) await expect(hop.getByText(c.name, { exact: true }).first()).toBeVisible();
  });

  test("[E2E-HB-NXS-02] lưu phiếu TRƯỚC điểm danh; tải lại trang phiếu vẫn còn ('Xem phiếu' mở ra đúng chữ đã lưu); kết quả mục vẫn chưa đổi", async ({ page }) => {
    await dangNhap(page, email.gv, "/teacher/hoc-bu");
    await moCase(page);
    await moHop(page, /^Nhận xét$/);
    const hop = page.getByRole("dialog");
    await hop.locator("textarea").first().fill(PHIEU);
    await hop.getByRole("button", { name: "Lưu nhận xét" }).click();
    await expect(page.getByText(/Đã lưu phiếu nhận xét/).first()).toBeVisible({ timeout: 60_000 });
    await expect.poll(async () => (await muc()).teacherEvaluation, { timeout: 30_000 }).toBe(PHIEU);
    expect((await muc()).result).toBe("PLANNED"); // chưa điểm danh

    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.getByText(TEN_BE).first()).toBeVisible({ timeout: 60_000 });
    await moHop(page, /^Xem phiếu$/);
    await expect(page.getByRole("dialog").locator("textarea").first()).toHaveValue(PHIEU);
  });

  test("[E2E-HB-NXS-03] phụ huynh KHÔNG thấy phiếu nháp khi buổi chưa có kết quả (đối chứng dương: cổng v2 đã bày chi tiết buổi bù của con)", async ({ page, context }) => {
    test.skip(!COT_V2, "cần PORTAL_V2_ENABLED=true: cổng cũ không bày chi tiết đánh giá nên ca này sẽ đúng một cách rỗng");
    await doiNguoi(page, context);
    await dangNhap(page, email.ph, "/portal/yeu-cau");
    await page.goto("/portal/yeu-cau", { waitUntil: "domcontentloaded" });
    await expect(page.getByText(LOP).first()).toBeVisible({ timeout: 60_000 });
    // Đối chứng dương: chi tiết v2 (tên bài) ĐÃ hiện — nếu không, "không thấy phiếu" chẳng chứng minh gì.
    await expect(page.getByText(/Bài một/).first()).toBeVisible({ timeout: 30_000 });
    const html = await page.content();
    expect(html).not.toContain(PHIEU);
    expect(html).not.toContain("viết sớm");
  });

  test("[E2E-HB-NXS-04] điểm danh xong KHÔNG xoá phiếu; nhận xét chung CŨ đã lưu từ trước được giữ và hiện để đọc", async ({ page, context }) => {
    // Dữ liệu cũ: bé đã có nhận xét chung từ trước (ô nhập đã gỡ, nhưng giá trị cũ không được mất).
    await db.makeupCaseParticipant.update({ where: { id: ids.partId }, data: { generalComment: CU } });
    await doiNguoi(page, context);
    await dangNhap(page, email.gv, "/teacher/hoc-bu");
    await moCase(page);
    await page.getByRole("button", { name: "Đã học xong" }).click();
    await page.getByRole("button", { name: /Có mặt — lưu kết quả/ }).click();
    await expect.poll(async () => (await muc()).result, { timeout: 60_000 }).toBe("COMPLETED");
    const sau = await muc();
    expect(sau.teacherEvaluation).toBe(PHIEU); // không bị điểm danh ghi đè thành null
    expect(sau.evaluationRubric).not.toBeNull();
    expect((await db.makeupCaseParticipant.findUniqueOrThrow({ where: { id: ids.partId } })).generalComment).toBe(CU);

    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.getByText(`Nhận xét chung (đã lưu từ trước): ${CU}`)).toBeVisible({ timeout: 60_000 });
    await moHop(page, /^Xem phiếu$/);
    await expect(page.getByRole("dialog").locator("textarea").first()).toHaveValue(PHIEU);
  });

  test("[E2E-HB-NXS-05] sau khi mục có kết quả, phụ huynh thấy đúng phiếu (đối chứng dương của NXS-03)", async ({ page, context }) => {
    test.skip(!COT_V2, "cần PORTAL_V2_ENABLED=true (xem ghi chú ở NXS-03)");
    await doiNguoi(page, context);
    await dangNhap(page, email.ph, "/portal/yeu-cau");
    await page.goto("/portal/yeu-cau", { waitUntil: "domcontentloaded" });
    await expect(page.getByText(LOP).first()).toBeVisible({ timeout: 60_000 });
    await expect(page.getByText(PHIEU).first()).toBeVisible({ timeout: 30_000 });
  });

  test("[E2E-HB-NXS-06] bé VẮNG buổi bù ⇒ mục bị gỡ ⇒ không còn nút 'Nhận xét' ở mục đó (và máy chủ từ chối lưu phiếu)", async ({ page, context }) => {
    // Dựng trạng thái "đã gỡ" bằng đường điểm danh thật rồi đo giao diện: sửa điểm danh sang VẮNG qua DB service sẽ làm ca dài; ở đây ta trả mục về RELEASED trực tiếp
    // (đường thật là điểm danh vắng; hành vi máy chủ đã có [PSOM-03] ở bộ DB).
    await db.makeupCaseStudent.update({ where: { id: ids.mucId }, data: { result: "RELEASED", status: "RELEASED", releasedAt: new Date() } });
    await db.makeupCaseParticipant.update({ where: { id: ids.partId }, data: { attendanceStatus: "ABSENT" } });
    await doiNguoi(page, context);
    await dangNhap(page, email.gv, "/teacher/hoc-bu");
    await moCase(page);
    await expect(page.getByRole("button", { name: /^(Nhận xét|Xem phiếu)$/ })).toHaveCount(0);
  });
});
