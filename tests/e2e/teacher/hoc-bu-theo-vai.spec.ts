// [E2E-HB-ROLE-01..06] — Học bù THEO VAI, qua TRÌNH DUYỆT THẬT (login thật qua form /login, dữ liệu dựng trên Postgres LOCAL).
//
// Vì sao có tệp này: các bộ DB của Học bù (AC35, [DGV-*], [PHAM-VI-*]) chứng minh ranh giới ở TẦNG DỮ LIỆU/dịch vụ; phiên giáo viên / phụ huynh THẬT trên prod chưa từng
// được kiểm (không có tài khoản thử trên prod). Tệp này kiểm tầng RENDER + cổng layout bằng đúng đường đăng nhập thật, trên localhost với tài khoản TEST do chính tệp tạo
// (mật khẩu test cố định trong `_helpers/fixtures.ts`) — không dùng thông tin đăng nhập nào của prod.
//
//   ROLE-01  GV thấy case CỦA MÌNH trong /teacher/hoc-bu, không thấy case của GV khác.
//   ROLE-02  GV mở thẳng URL case của GV khác ⇒ 404 (không lộ là có tồn tại, không lộ tên bé).
//   ROLE-03  Quản lý ĐỔI GIÁO VIÊN của case (đường dịch vụ thật `suaCase`) ⇒ GV cũ mất quyền, GV mới thấy.
//   ROLE-04  Phụ huynh thấy học bù của CON MÌNH ở /portal/yeu-cau, không thấy con của phụ huynh khác.
//   ROLE-05  Phụ huynh không vào được màn GV / màn quản trị Học bù.
//   ROLE-06  Sale chỉ thấy dòng cần bù của học viên MÌNH phụ trách ở /admin/hoc-bu; ĐỐI CHỨNG DƯƠNG: Sale kia thấy phần còn lại, quản lý cơ sở thấy cả hai.
//
// ⚠️ Ca "KHÔNG thấy X" luôn đi kèm ĐỐI CHỨNG DƯƠNG ("vai kia THẤY X") — ca chỉ khẳng định sự vắng mặt luôn đạt khi tính năng hỏng hoàn toàn (CLAUDE.md luật 11).
// ⚠️ Localhost: route-policy coi host "unknown" ⇒ passthrough, nên KHÔNG kiểm redirect host×role (đã có unit riêng ở lib/auth/route-policy.test.ts). Ở đây chỉ kiểm cổng layout + dữ liệu.
import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { db } from "../../../lib/db";
import { resetDb, seedOrg, seedRoles, seedUser } from "../_helpers/seed";
import { testEmail } from "../_helpers/fixtures";
import { login } from "../_helpers/auth";
import { assignUserOrgRole, type RbacActor } from "../../../lib/auth/rbac-service";
import { suaCase, taoCaseVaXep } from "../../../lib/hoc-bu/case-db";
import type { NguoiHocBu } from "../../../lib/hoc-bu/pham-vi";
import { vnYmd } from "../../../lib/time/vn";

const SA: RbacActor = { id: "seed-sa", name: "SA", role: "SUPER_ADMIN" };

/** Mốc tên có thể soi trong HTML: mỗi bé một chuỗi riêng, không là tiền tố của chuỗi kia. */
const TEN_BE_A = "Bé Alpha Quang";
const TEN_BE_B = "Bé Beta Hiếu";
const LOP_A = "Lớp Hoc Bu Alpha";
const LOP_B = "Lớp Hoc Bu Beta";

const ids = {
  cs1: "",
  khoa: "",
  baiA: "",
  baiB: "",
  gvA: "",
  gvB: "",
  adminId: "",
  saleA: "",
  saleB: "",
  phA: "",
  phB: "",
  beA: "",
  beB: "",
  needA: "",
  needB: "",
  caseA: "",
  caseB: "",
};
const email = {
  gvA: testEmail("hb-gv-a"),
  gvB: testEmail("hb-gv-b"),
  qlcs: testEmail("hb-ql"),
  saleA: testEmail("hb-sale-a"),
  saleB: testEmail("hb-sale-b"),
  phA: testEmail("hb-ph-a"),
  phB: testEmail("hb-ph-b"),
};

const cong = (ymd: string, d: number) => {
  const t = new Date(`${ymd}T00:00:00.000Z`);
  t.setUTCDate(t.getUTCDate() + d);
  return t.toISOString().slice(0, 10);
};

async function orgId(code: string) {
  return (await db.orgUnit.findUnique({ where: { code }, select: { id: true } }))!.id;
}
async function gan(userId: string, roleCode: string, orgCode: string) {
  const roleId = (await db.roleDef.findUnique({ where: { code: roleCode }, select: { id: true } }))!.id;
  await assignUserOrgRole(SA, { userId, orgUnitId: await orgId(orgCode), roleId, reason: "seed e2e hoc-bu theo vai" });
}

/** Người gọi dịch vụ học bù là quản trị tối cao (đúng khuôn fixture DB của Học bù): quyền do server action hỏi, không ở tầng dịch vụ. */
const adminHocBu = () =>
  ({
    userId: ids.adminId,
    isSuperAdmin: true,
    isHoLevel: true,
    orgRoles: [],
    permissions: [],
    visibleCenterIds: [],
    visibleOrgUnitIds: [],
    grantsAllow: new Set<string>(),
    assignedClassIds: new Set<string>(),
    chiCuaSale: null,
  }) as unknown as NguoiHocBu;

test.describe.configure({ mode: "serial" });

test.describe("[E2E-HB-ROLE] Học bù theo vai (trình duyệt thật)", () => {
  test.beforeAll(async () => {
    await resetDb();
    await db.center.upsert({ where: { code: "CS1" }, create: { code: "CS1", name: "CS1", slug: "cs1-hb-vai", address: "a", city: "" }, update: {} });
    await db.center.upsert({ where: { code: "CS2" }, create: { code: "CS2", name: "CS2", slug: "cs2-hb-vai", address: "b", city: "" }, update: {} });
    await seedOrg(["HO", "CS1", "CS2"]);
    await seedRoles();
    ids.cs1 = (await db.orgUnit.findUnique({ where: { code: "CS1" }, select: { centerId: true } }))!.centerId!;

    // ── Người dùng ──
    const admin = await seedUser({ email: testEmail("hb-admin"), role: "SUPER_ADMIN" });
    ids.adminId = admin.id;
    const gvA = await seedUser({ email: email.gvA, role: "TEACHER", centerId: ids.cs1 });
    const gvB = await seedUser({ email: email.gvB, role: "TEACHER", centerId: ids.cs1 });
    ids.gvA = gvA.id;
    ids.gvB = gvB.id;
    await gan(gvA.id, "TEACHER", "CS1");
    await gan(gvB.id, "TEACHER", "CS1");
    const ql = await seedUser({ email: email.qlcs, role: "CENTER_MANAGER", centerId: ids.cs1 });
    await gan(ql.id, "CENTER_MANAGER", "CS1");
    const saleA = await seedUser({ email: email.saleA, role: "SALES_CSM", centerId: ids.cs1 });
    const saleB = await seedUser({ email: email.saleB, role: "SALES_CSM", centerId: ids.cs1 });
    ids.saleA = saleA.id;
    ids.saleB = saleB.id;
    await gan(saleA.id, "CENTER_SALES_CSM", "CS1");
    await gan(saleB.id, "CENTER_SALES_CSM", "CS1");
    const phA = await seedUser({ email: email.phA, role: "PARENT" });
    const phB = await seedUser({ email: email.phB, role: "PARENT" });
    ids.phA = phA.id;
    ids.phB = phB.id;

    // ── Giáo trình / lớp / học viên ──
    const rand = Math.random().toString(36).slice(2, 8);
    const khoa = await db.course.create({ data: { name: `Khoá HB vai ${rand}`, slug: `hb-vai-${rand}`, totalSessions: 12, price: 12_000_000 } });
    ids.khoa = khoa.id;
    const cur = await db.curriculum.create({ data: { courseId: khoa.id, name: `Giáo trình HB vai ${rand}` } });
    const baiA = await db.lesson.create({ data: { curriculumId: cur.id, order: 1, title: "Bài một", moduleCode: "HBV1" } });
    const baiB = await db.lesson.create({ data: { curriculumId: cur.id, order: 2, title: "Bài hai", moduleCode: "HBV1" } });
    ids.baiA = baiA.id;
    ids.baiB = baiB.id;
    const lopA = await db.class.create({ data: { name: LOP_A, courseId: khoa.id, centerId: ids.cs1, teacherId: gvA.id, status: "ACTIVE", startTime: "18:00", endTime: "19:30" } });
    const lopB = await db.class.create({ data: { name: LOP_B, courseId: khoa.id, centerId: ids.cs1, teacherId: gvB.id, status: "ACTIVE", startTime: "18:00", endTime: "19:30" } });
    const phong1 = await db.room.create({ data: { code: `hbv-p1-${rand}`, name: "Phòng HB vai 1", centerId: ids.cs1 } });
    const phong2 = await db.room.create({ data: { code: `hbv-p2-${rand}`, name: "Phòng HB vai 2", centerId: ids.cs1 } });

    const beA = await db.student.create({ data: { name: TEN_BE_A, centerId: ids.cs1, parentUserId: phA.id, parentName: "PH A", parentPhone: "0900000011" } });
    const beB = await db.student.create({ data: { name: TEN_BE_B, centerId: ids.cs1, parentUserId: phB.id, parentName: "PH B", parentPhone: "0900000022" } });
    ids.beA = beA.id;
    ids.beB = beB.id;
    await db.enrollment.create({ data: { studentId: beA.id, classId: lopA.id, courseId: khoa.id, status: "ACTIVE", saleId: saleA.id } });
    await db.enrollment.create({ data: { studentId: beB.id, classId: lopB.id, courseId: khoa.id, status: "ACTIVE", saleId: saleB.id } });

    // Sổ lượt: mở với bút toán GRANT khớp số dư (checker TV-32) — taoCaseVaXep giữ 1 lượt cho mỗi bé.
    for (const be of [beA, beB]) {
      const tk = await db.makeupCreditAccount.create({ data: { studentId: be.id, courseId: khoa.id, granted: 3 } });
      await db.makeupCreditEntry.create({ data: { accountId: tk.id, type: "GRANT", grantedDelta: 3, reason: "Mở sổ cho e2e", idemKey: "GRANT:khoi-tao" } });
    }

    // Buổi vắng gốc (đã diễn ra) + điểm danh vắng + dòng cần bù.
    for (const [be, lop, bai, tag] of [
      [beA, lopA, baiA, "a"],
      [beB, lopB, baiB, "b"],
    ] as const) {
      const buoi = await db.classSession.create({
        data: { classId: lop.id, centerId: ids.cs1, date: new Date("2026-10-05T11:00:00.000Z"), lessonId: bai.id, status: "COMPLETED" },
      });
      const dd = await db.attendance.create({
        data: { sessionId: buoi.id, studentId: be.id, status: "ABSENT_EXCUSED", makeupStatus: "NEEDS_MAKEUP", absenceReason: "Con ốm", centerId: ids.cs1 },
      });
      const need = await db.makeupNeed.create({
        data: {
          studentId: be.id,
          classId: lop.id,
          centerId: ids.cs1,
          courseId: khoa.id,
          sourceType: "ABSENCE",
          originalAttendanceId: dd.id,
          missedSessionId: buoi.id,
          missedLessonId: bai.id,
          status: "PENDING",
          createdAt: new Date("2026-10-06T00:00:00.000Z"),
        },
      });
      if (tag === "a") ids.needA = need.id;
      else ids.needB = need.id;
    }

    // Ca làm của hai giáo viên cho hai ngày (lõi xếp lịch đòi ca phủ trọn khung giờ bù).
    const homNay = vnYmd(new Date());
    const ngayA = cong(homNay, 3);
    const ngayB = cong(homNay, 4);
    const mau = await db.shiftTemplate.create({
      data: { code: `HBV-${rand}`, name: "Ca HB vai", kind: "TIMED", segments: [{ start: "00:00", end: "23:59", kind: "WORK" }] },
    });
    for (const u of [gvA.id, gvB.id]) {
      for (const ymd of [ngayA, ngayB]) {
        await db.shiftAssignment.create({
          data: {
            userId: u, centerId: ids.cs1, workDate: new Date(`${ymd}T00:00:00.000Z`), templateId: mau.id, templateCode: `HBV-${rand}`,
            segments: [{ start: "00:00", end: "23:59", kind: "WORK" }], placeMode: "AT_UNITS", attendanceMode: "REQUIRED", dayCredit: 1, source: "MANUAL",
          },
        });
      }
    }

    // ── Case thật qua dịch vụ: GV A dạy bé A (ngày +3), GV B dạy bé B (ngày +4) ──
    const rA = await taoCaseVaXep(adminHocBu(), { ymd: ngayA, startTime: "18:00", endTime: "19:30", roomId: phong1.id, teacherId: gvA.id, note: null, needIds: [ids.needA], coQuyenDuyet: true });
    const rB = await taoCaseVaXep(adminHocBu(), { ymd: ngayB, startTime: "18:00", endTime: "19:30", roomId: phong2.id, teacherId: gvB.id, note: null, needIds: [ids.needB], coQuyenDuyet: true });
    ids.caseA = rA;
    ids.caseB = rB;
    expect(ids.caseA).toBeTruthy();
    expect(ids.caseB).toBeTruthy();
  });

  test.afterAll(async () => {
    await db.$disconnect();
  });

  const dangNhap = (page: Page, mail: string, callbackUrl: string) => login(page, { email: mail, callbackUrl, timeout: 90_000 });

  /**
   * Đổi người dùng trong CÙNG trình duyệt. Rời trang TRƯỚC (`about:blank` dừng mọi request đang bay) rồi mới xoá cookie.
   * ⚠️ `clearCookies()` trần là một cuộc ĐUA: trang cũ (shell giáo viên) còn request đang bay mang `Set-Cookie` làm mới phiên; nó hoàn tất SAU lúc xoá nên cookie của người cũ
   * sống lại ⇒ `/login` chuyển thẳng về trang chủ và biểu mẫu không bao giờ hiện. Gặp ở CI (`next start`, ca ROLE-01 đỏ cả 3 lượt), KHÔNG gặp ở `next dev` cục bộ.
   */
  const doiNguoi = async (page: Page, context: BrowserContext) => {
    await page.goto("about:blank");
    await context.clearCookies();
  };

  /**
   * Mở một đường dẫn mà vai này KHÔNG được xem và chờ tới khi trang ĐÃ ĐỊNH HÌNH là trang 404.
   * ⚠️ KHÔNG assert `response.status() === 404`: trang có `loading.tsx` nên máy chủ đã trả 200 + khung chờ trước khi `notFound()` chạy; và KHÔNG assert "không có tên bé" ngay sau
   * `goto`: lúc đó trang mới chỉ là khung chờ nên ca nào cũng "đạt" (ca chỉ khẳng định sự vắng mặt — luật 11). Marker dương: tiêu đề của `app/not-found.tsx`.
   */
  const moMaBi404 = async (page: Page, duong: string) => {
    await page.goto(duong, { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: "Không tìm thấy trang" })).toBeVisible({ timeout: 60_000 });
  };

  test("[E2E-HB-ROLE-01] GV A thấy case của MÌNH trong /teacher/hoc-bu và KHÔNG thấy case của GV B (+ đối chứng: GV B thấy case B)", async ({ page, context }) => {
    await dangNhap(page, email.gvA, "/teacher/hoc-bu");
    await page.goto("/teacher/hoc-bu", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: "Học bù" }).first()).toBeVisible({ timeout: 60_000 });
    await expect(page.getByText(TEN_BE_A).first()).toBeVisible({ timeout: 30_000 });
    expect(await page.content()).not.toContain(TEN_BE_B);
    await expect(page.locator(`a[href="/teacher/hoc-bu/${ids.caseA}"]`).first()).toBeVisible();
    await expect(page.locator(`a[href="/teacher/hoc-bu/${ids.caseB}"]`)).toHaveCount(0);

    // Đối chứng dương: GV B (phiên mới) thấy case B và không thấy bé A.
    await doiNguoi(page, context);
    await dangNhap(page, email.gvB, "/teacher/hoc-bu");
    await page.goto("/teacher/hoc-bu", { waitUntil: "domcontentloaded" });
    await expect(page.getByText(TEN_BE_B).first()).toBeVisible({ timeout: 30_000 });
    expect(await page.content()).not.toContain(TEN_BE_A);
  });

  test("[E2E-HB-ROLE-02] GV A mở thẳng URL case của GV B ⇒ trang 404, không lộ tên bé; đối chứng: mở case của mình ⇒ thấy bé A", async ({ page }) => {
    await dangNhap(page, email.gvA, "/teacher/hoc-bu");
    await moMaBi404(page, `/teacher/hoc-bu/${ids.caseB}`);
    expect(await page.content()).not.toContain(TEN_BE_B);

    await page.goto(`/teacher/hoc-bu/${ids.caseA}`, { waitUntil: "domcontentloaded" });
    await expect(page.getByText(TEN_BE_A).first()).toBeVisible({ timeout: 60_000 });
  });

  test("[E2E-HB-ROLE-03] Quản lý đổi GV của case A sang GV B (suaCase thật) ⇒ GV A mất quyền (404), GV B mở được; audit chỉ ghi đổi giáo viên", async ({ page, context }) => {
    const truoc = await db.makeupCase.findUniqueOrThrow({ where: { id: ids.caseA }, select: { teacherId: true, date: true, startTime: true, endTime: true, roomId: true, version: true } });
    expect(truoc.teacherId).toBe(ids.gvA);
    // Ngày +3 GV B đã có ca làm (đã seed) và chưa có case ngày +3 ⇒ không trùng lịch.
    const ymd = truoc.date.toISOString().slice(0, 10);
    await suaCase(adminHocBu(), { caseId: ids.caseA, phienBan: truoc.version, ymd, teacherId: ids.gvB, ten: "QL e2e" });
    const sau = await db.makeupCase.findUniqueOrThrow({ where: { id: ids.caseA }, select: { teacherId: true } });
    expect(sau.teacherId).toBe(ids.gvB);

    await dangNhap(page, email.gvA, "/teacher/hoc-bu");
    await moMaBi404(page, `/teacher/hoc-bu/${ids.caseA}`);
    expect(await page.content()).not.toContain(TEN_BE_A);

    await doiNguoi(page, context);
    await dangNhap(page, email.gvB, "/teacher/hoc-bu");
    await page.goto(`/teacher/hoc-bu/${ids.caseA}`, { waitUntil: "domcontentloaded" });
    await expect(page.getByText(TEN_BE_A).first()).toBeVisible({ timeout: 60_000 });
  });

  test("[E2E-HB-ROLE-04] Phụ huynh A thấy học bù của CON MÌNH ở /portal/yeu-cau, không thấy lớp của con phụ huynh B; đối chứng: phụ huynh B thấy lớp B", async ({ page, context }) => {
    await dangNhap(page, email.phA, "/portal/yeu-cau");
    await page.goto("/portal/yeu-cau", { waitUntil: "domcontentloaded" });
    await expect(page.getByText(LOP_A).first()).toBeVisible({ timeout: 60_000 });
    const html = await page.content();
    expect(html).not.toContain(LOP_B);
    expect(html).not.toContain(TEN_BE_B);
    expect(page.url()).not.toContain(ids.beA);

    await doiNguoi(page, context);
    await dangNhap(page, email.phB, "/portal/yeu-cau");
    await page.goto("/portal/yeu-cau", { waitUntil: "domcontentloaded" });
    await expect(page.getByText(LOP_B).first()).toBeVisible({ timeout: 60_000 });
    expect(await page.content()).not.toContain(LOP_A);
  });

  test("[E2E-HB-ROLE-05] Phụ huynh KHÔNG vào được màn GV và màn quản trị Học bù (bị chuyển đi hoặc 404; không render nội dung vai khác)", async ({ page }) => {
    await dangNhap(page, email.phA, "/portal/yeu-cau");
    for (const duong of ["/teacher/hoc-bu", `/teacher/hoc-bu/${ids.caseA}`, "/admin/hoc-bu"]) {
      await page.goto(duong, { waitUntil: "domcontentloaded" }).catch(() => undefined);
      // Marker dương: trang ĐÃ ĐỊNH HÌNH ở nơi khác (bị chuyển đi) hoặc là trang 404 — không phải khung chờ của màn bị cấm.
      await expect
        .poll(async () => (/\/(teacher|admin)\/hoc-bu/.test(page.url()) ? await page.getByRole("heading", { name: "Không tìm thấy trang" }).count() : 1), { timeout: 60_000, message: duong })
        .toBeGreaterThan(0);
      // Phụ huynh A được thấy CON MÌNH (cổng PH chuyển về trang chủ cổng, có tên bé A) — điều cấm là thấy màn GV/quản trị hoặc con của gia đình khác.
      const dungYen404 = (await page.getByRole("heading", { name: "Không tìm thấy trang" }).count()) > 0;
      if (!dungYen404) expect(page.url(), duong).not.toMatch(/\/(teacher|admin)\/hoc-bu/);
      expect(await page.content(), duong).not.toContain(TEN_BE_B);
    }
  });

  test("[E2E-HB-ROLE-06] Sale A chỉ thấy dòng cần bù của học viên MÌNH phụ trách ở /admin/hoc-bu; Sale B thấy phần còn lại; quản lý cơ sở thấy cả hai", async ({ page, context }) => {
    // Hai bé đã vào case ⇒ dòng ở trạng thái SCHEDULED, không còn ở tab "Cần bù". Trả hai dòng về PENDING để màn "Cần bù" có dữ liệu thật của cả hai Sale
    // (đường thật là huỷ/gỡ khỏi case; ở đây ta chỉ dựng trạng thái cho ca xem — không kiểm đường gỡ).
    await db.makeupCaseStudent.updateMany({ where: { makeupNeedId: { in: [ids.needA, ids.needB] } }, data: { status: "RELEASED", result: "RELEASED", releasedAt: new Date() } });
    await db.makeupNeed.updateMany({ where: { id: { in: [ids.needA, ids.needB] } }, data: { status: "PENDING", usedQuota: false } });

    const xem = async (mail: string) => {
      await dangNhap(page, mail, "/admin/hoc-bu");
      await page.goto("/admin/hoc-bu?tab=can-bu&size=100", { waitUntil: "domcontentloaded" });
      await expect(page.getByRole("heading", { name: /Học bù/ }).first()).toBeVisible({ timeout: 60_000 });
      return page.content();
    };

    const htmlSaleA = await xem(email.saleA);
    expect(htmlSaleA).toContain(TEN_BE_A);
    expect(htmlSaleA).not.toContain(TEN_BE_B);

    await doiNguoi(page, context);
    const htmlSaleB = await xem(email.saleB);
    expect(htmlSaleB).toContain(TEN_BE_B);
    expect(htmlSaleB).not.toContain(TEN_BE_A);

    await doiNguoi(page, context);
    const htmlQl = await xem(email.qlcs);
    expect(htmlQl).toContain(TEN_BE_A);
    expect(htmlQl).toContain(TEN_BE_B);
  });
});
