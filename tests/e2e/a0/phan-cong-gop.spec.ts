/**
 * 26/10/2026 — GĐ3 PHÂN CÔNG GỘP qua TRÌNH DUYỆT (docs/phan-cong-gop/KHAO-SAT.md · TIEN-DO-DEM.md).
 *
 * Hỏi "nút có nối không" — luật thì đã có lưới thuần (`[MAO-*]` `[CQK-*]` `[LG-*]`) và Postgres thật (`[PCG2-GG*]`).
 *
 * ⚠️ HAI NHÓM, theo chế độ quyền:
 *   · CHỈ XEM — chạy ở MỌI chế độ (CI chạy RBAC v1): lưới hiện, cờ trùng giờ, chế độ tháng → bấm ô về tuần + mở panel, chuyển hướng
 *     308 từ route cũ, cơ sở CHƯA BẬT chỉ xem.
 *   · GHI — chỉ khi `RBAC_V2_ENABLED=true` (như prod). Công tắc Parttime ghi FAIL-CLOSED ở RBAC v1 (`congThaoTacParttime` ⇒
 *     RBAC_V2_REQUIRED_FOR_PARTTIME) nên ở v1 màn đúng là chỉ xem — ca ghi đánh dấu `skip` kèm lý do, KHÔNG phải xanh. Chạy ở máy:
 *       RBAC_V2_ENABLED=true pnpm exec playwright test -c playwright.a0.config.ts tests/e2e/a0/phan-cong-gop.spec.ts
 *
 * Ngày cố định ở 03/2027 (luật 19: không theo đồng hồ — chỉ cần SAU hôm nay để không vướng cổng "ngày đã qua").
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test, expect, type Page } from "@playwright/test";
import { db } from "../../../lib/db";
import { resetDb, seedOrg, seedRoles, seedUser } from "../_helpers/seed";
import { login } from "../_helpers/auth";
import { assignUserOrgRole, type RbacActor } from "../../../lib/auth/rbac-service";

const SA: RbacActor = { id: "seed-sa-pcg3", name: "SA", role: "SUPER_ADMIN" };
const V2 = process.env.RBAC_V2_ENABLED === "true";
const EMAIL = ["sa1@pcg3.vn", "sa2@pcg3.vn", "sa3@pcg3.vn", "sa4@pcg3.vn", "sa5@pcg3.vn", "sa6@pcg3.vn", "sa7@pcg3.vn", "sa8@pcg3.vn", "sa9@pcg3.vn", "sa10@pcg3.vn"] as const;
const TUAN = "2027-03-01"; // Thứ Hai
const T4 = "2027-03-03";
const T4_SAU = "2027-03-10";
const T5 = "2027-03-04";
const vn = (ymd: string, hhmm: string) => new Date(`${ymd}T${hhmm}:00+07:00`);

let CS1 = "";
let CS2 = "";
const gv: Record<"an" | "binh" | "chi", string> = { an: "", binh: "", chi: "" };
const buoi: Record<string, string> = {};

async function gan(userId: string, orgCode: string, roleCode: string) {
  const org = await db.orgUnit.findFirstOrThrow({ where: { code: orgCode }, select: { id: true } });
  const role = await db.roleDef.findUniqueOrThrow({ where: { code: roleCode }, select: { id: true } });
  await assignUserOrgRole(SA, { userId, orgUnitId: org.id, roleId: role.id, reason: "e2e phân công gộp" });
}

test.describe.configure({ timeout: 120_000, mode: "serial" });

test.beforeAll(async () => {
  await resetDb();
  await seedOrg(["HO", "CS1", "CS2"]);
  await seedRoles();
  CS1 = (await db.center.findUniqueOrThrow({ where: { code: "CS1" }, select: { id: true } })).id;
  CS2 = (await db.center.findUniqueOrThrow({ where: { code: "CS2" }, select: { id: true } })).id;
  for (const e of EMAIL) {
    const u = await seedUser({ email: e, role: "SUPER_ADMIN" });
    await gan(u.id, "HO", "SUPER_ADMIN");
  }
  for (const [k, ten] of [["an", "GV An"], ["binh", "GV Bình"], ["chi", "GV Chi"]] as const) {
    gv[k] = (await seedUser({ email: `${k}@pcg3.vn`, name: ten, role: "TEACHER", centerId: CS2 })).id;
  }
  // Chính sách SR.QD.238 (resetDb xoá cả dòng do migration nạp) — tham số lấy NGUYÊN VĂN từ migration.
  const sql = readFileSync(resolve(process.cwd(), "prisma/migrations/20261026090000_cong_parttime_nen/migration.sql"), "utf8");
  const m = /'(\{"loai":"SR_QD_238".*?\})'::jsonb/.exec(sql);
  if (!m) throw new Error("không thấy paramsJson SR.QD.238 trong migration");
  await db.compensationPolicyVersion.create({
    data: { id: "cpv_sr_qd_238", code: "SR.QD.238", name: "Chính sách thù lao Nhân sự Parttime", documentNo: "SR.QD.238", appliesTo: "PARTTIME", effectiveFrom: new Date("2026-10-15T00:00:00Z"), paramsJson: JSON.parse(m[1]) },
  });
  // Công tắc phân công: BẬT ở CS2, CS1 để mặc định (tắt) — ca "chỉ xem".
  const ou2 = await db.orgUnit.findFirstOrThrow({ where: { centerId: CS2 }, select: { id: true } });
  await db.centerSetting.create({ data: { orgUnitId: ou2.id, key: "shift.parttimeStaffingEnabled", valueJson: true } });

  const khoa = await db.course.create({ data: { name: "Sata pcg3", slug: "pcg3-k" }, select: { id: true } });
  const lop = async (ten: string, gio: [string, string], ngays: string[]) => {
    const l = await db.class.create({ data: { name: ten, courseId: khoa.id, centerId: CS2, teacherId: gv.an, startTime: gio[0], endTime: gio[1] }, select: { id: true } });
    for (const n of ngays) buoi[`${ten}|${n}`] = (await db.classSession.create({ data: { classId: l.id, centerId: CS2, status: "SCHEDULED", date: vn(n, gio[0]) }, select: { id: true } })).id;
  };
  // An đứng hai lớp CHỒNG giờ thứ Tư (14:00–15:30 và 15:00–16:30) ⇒ cờ trùng giờ; lớp A còn buổi tuần sau (ca "các tuần sau").
  await lop("Lớp A pcg3", ["14:00", "15:30"], [T4, T4_SAU]);
  await lop("Lớp B pcg3", ["15:00", "16:30"], [T4]);
});

const GIO: Record<string, [string, string]> = { "Lớp A pcg3": ["14:00", "15:30"], "Lớp B pcg3": ["15:00", "16:30"] };
/** Một dòng phân công đúng HÌNH DẠNG bộ đồng bộ / màn ghi. Dựng thẳng vì `phan-cong-db.ts` là mô-đun server ("server-only") —
 *  Playwright không nạp được; hành vi của chính cửa ghi đã có bộ Postgres thật `[PCG2-GG*]`. */
async function phanCong(k: string, userId: string, role: "MAIN_TEACHER" | "TEACHING_ASSISTANT", nguonGiao: "DONG_BO" | "TAY") {
  const [ten, ngay] = k.split("|") as [string, string];
  const ou = await db.orgUnit.findFirstOrThrow({ where: { centerId: CS2 }, select: { id: true } });
  await db.sessionStaffAssignment.create({
    data: {
      sourceType: "CLASS_SESSION",
      sourceId: buoi[k]!,
      centerId: CS2,
      orgUnitId: ou.id,
      ngay: new Date(`${ngay}T00:00:00Z`),
      gioBatDau: GIO[ten]![0],
      gioKetThuc: GIO[ten]![1],
      userId,
      role,
      activityType: "REGULAR_CLASS",
      assignmentType: nguonGiao === "TAY" ? "MANUAL" : "SYSTEM",
      nguonGiao,
      status: "ACCEPTED",
    },
  });
}
/** Lịch GỐC trước MỖI ca (luật 18 — ca nào chạy một mình cũng xanh): An đứng chính mọi buổi, không trợ giảng, không dạy thay, không trực. */
async function datLaiLich() {
  const ids = Object.values(buoi);
  const pcs = await db.sessionStaffAssignment.findMany({ where: { sourceId: { in: ids } }, select: { id: true } });
  await db.auditLog.deleteMany({ where: { entityId: { in: pcs.map((x) => x.id) } } });
  await db.sessionStaffAssignment.deleteMany({ where: { sourceId: { in: ids } } });
  await db.operationsDutyAssignment.deleteMany({ where: { centerId: CS2 } });
  await db.classSession.updateMany({ where: { id: { in: ids } }, data: { substituteTeacherId: null } });
  for (const k of Object.keys(buoi)) await phanCong(k, gv.an, "MAIN_TEACHER", "DONG_BO");
}
test.beforeEach(() => datLaiLich());

const moTuan = (page: Page, coSo: string, them = "") => page.goto(`/cham-cong/phan-cong?coSo=${coSo}&tuan=${TUAN}${them}`);
const TEN_CA: Record<string, string> = { S: "Sáng", C: "Chiều", T: "Tối" };
const o = (page: Page, ten: string, ngay: string, ca: string) =>
  page.getByRole("button", { name: new RegExp(`^${ten} · T\\d ${ngay.slice(8, 10)}/${ngay.slice(5, 7)} · ${TEN_CA[ca]}:`) });
/** Panel là CỘT cạnh lưới (mockup 26/10) — không phải hộp thoại, không che lưới. */
const panel = (page: Page) => page.getByRole("complementary", { name: "Chi tiết phân công" });
const theBuoi = (page: Page, k: string) => panel(page).locator(`[data-buoi="CLASS_SESSION:${buoi[k]}"]`);

test("[PCG3-E2E-01] lưới tuần hiện mã ô; hai lớp chồng giờ ⇒ ô mang cờ trùng giờ (chữ, không chỉ màu)", async ({ page }) => {
  await login(page, { email: EMAIL[0] });
  await moTuan(page, CS2);
  await expect(page.locator('[data-luoi="phan-cong-gop"]')).toBeVisible();
  await expect(o(page, "GV An", T4, "C")).toHaveAccessibleName(/D2 · trùng giờ/);
  await expect(o(page, "GV Bình", T4, "C")).toHaveAccessibleName(/: X$/);
});

test("[PCG3-E2E-02] route cũ /cham-cong/phan-cong-gv ⇒ chuyển hướng về màn gộp, giữ cơ sở + tuần", async ({ page }) => {
  await login(page, { email: EMAIL[1] });
  await page.goto(`/cham-cong/phan-cong-gv?coSo=${CS2}&tuan=${TUAN}`);
  await expect(page).toHaveURL(new RegExp(`/cham-cong/phan-cong\\?coSo=${CS2}&tuan=${TUAN}`));
  await expect(page.locator('[data-luoi="phan-cong-gop"]')).toBeVisible();
});

test("[PCG3-E2E-03] chế độ tháng CHỈ XEM; bấm ô ⇒ về đúng tuần và mở panel ô đó", async ({ page }) => {
  await login(page, { email: EMAIL[2] });
  await moTuan(page, CS2, "&che=thang");
  const thang = page.locator('[data-luoi="phan-cong-gop-thang"]');
  await expect(thang).toBeVisible();
  await expect(thang.locator("select, button")).toHaveCount(0);
  await thang.getByRole("link", { name: /GV An 03\/03 Chiều/ }).click();
  await expect(page).toHaveURL(/o=/);
  await expect(panel(page)).toContainText("GV An");
  await expect(panel(page).locator("[data-cap-quet]")).toBeVisible();
});

test("[PCG3-E2E-04] cơ sở CHƯA BẬT phân công ⇒ panel nói chỉ xem, KHÔNG có nút ghi", async ({ page }) => {
  // CS1 không có giáo viên ⇒ dựng một người để có ô bấm.
  await seedUser({ email: "dung@pcg3.vn", name: "GV Dung", role: "TEACHER", centerId: CS1 });
  await login(page, { email: EMAIL[3] });
  await moTuan(page, CS1);
  await o(page, "GV Dung", T4, "S").click();
  const dlg = panel(page);
  await expect(dlg.locator("[data-chi-xem]")).toContainText("chưa bật phân công");
  await expect(dlg.getByRole("button", { name: /ca trực|Giao đứng chính|Giao trợ giảng/ })).toHaveCount(0);
  // Ô trống của người chỉ xem: "·", KHÔNG mời "+ Giao" (luật 12).
  await expect(o(page, "GV Dung", T4, "S")).not.toContainText("+ Giao");
});

test("[PCG3-E2E-09] 375px: trang KHÔNG cuộn ngang (lưới cuộn trong khung riêng); panel ô và panel ngày vừa màn", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await login(page, { email: EMAIL[8] });
  await moTuan(page, CS2);
  const luoi = page.locator('[data-luoi="phan-cong-gop"]');
  await expect(luoi).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
  expect(await luoi.evaluate((t) => (t.parentElement as HTMLElement).scrollWidth > (t.parentElement as HTMLElement).clientWidth)).toBe(true);
  await o(page, "GV An", T4, "C").click();
  // ≤ 768px: panel xuống DƯỚI lưới (không phủ) và trang tự cuộn tới nó.
  const vua = async () => {
    const h = await panel(page).boundingBox();
    const l = await luoi.boundingBox();
    return !!h && !!l && h.x >= 0 && h.x + h.width <= 376 && h.y >= l.y + l.height - 1;
  };
  await expect.poll(vua).toBe(true);
  await expect(panel(page).locator("[data-panel-o]")).toBeInViewport({ ratio: 0.2 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
  await page.getByRole("button", { name: /Buổi trong ngày T4 03\/03/ }).click();
  await expect(panel(page).locator("[data-panel-ngay]")).toBeVisible();
  await expect.poll(vua).toBe(true);
  await page.locator('[data-chip-buoi="2027-03-03.C"]').click();
  await expect(panel(page).locator("[data-panel-buoi]")).toBeVisible();
  await expect.poll(vua).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
});

// GĐ6 (lượt 2) — các màn MỚI của công Parttime ở 375px + cờ kỳ CẢ HAI vế trên giao diện. Kỳ 11/2026 còn ở TƯƠNG LAI so với đồng hồ thật
// nên ô nào cũng chưa tới hạn — ca này đo KHUNG màn (tab, điều hướng tháng, trạng thái rỗng), không đo dữ liệu ô (đã có `[CK-DB-*]` `[PA-*]`).
test("[PCG6-E2E-01] 375px: tab 'Tổng hợp tự động' + 'Phản ánh chờ duyệt' của kỳ 11 vừa màn; kỳ 10 KHÔNG có hai tab đó", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await login(page, { email: EMAIL[9] });
  for (const xem of ["tu-dong", "phan-anh"] as const) {
    await page.goto(`/cham-cong/phan-cong/thang?coSo=${CS2}&thang=2026-11&xem=${xem}`);
    await expect(page.getByRole("link", { name: xem === "tu-dong" ? "Tổng hợp tự động" : "Phản ánh chờ duyệt" })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
  }
  // Đối chứng (chốt 8): kỳ 10 đi luật cũ ⇒ không có hai góc nhìn mới, vẫn có "Đối soát & xác nhận".
  await page.goto(`/cham-cong/phan-cong/thang?coSo=${CS2}&thang=2026-10`);
  await expect(page.getByRole("link", { name: "Đối soát & xác nhận" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Tổng hợp tự động" })).toHaveCount(0);
});

test("[PCG6-E2E-02] 375px: site GV 'Ô công cần xem' kỳ 11 vừa màn; kỳ 10 nói rõ đi cách tính cũ", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await login(page, { email: "an@pcg3.vn" });
  await page.goto("/teacher/phan-cong/cong-o?thang=2026-11");
  await expect(page.getByRole("heading", { name: "Ô công cần xem" })).toBeVisible();
  await expect(page.getByText("Tháng này đi cách tính cũ")).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
  await page.goto("/teacher/phan-cong/cong-o?thang=2026-10");
  await expect(page.getByText("Tháng này đi cách tính cũ")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
});

test.describe("ghi (RBAC v2 — như prod)", () => {
  test.skip(!V2, "Công tắc Parttime ghi fail-closed ở RBAC v1 — chạy ở máy với RBAC_V2_ENABLED=true (xem đầu tệp).");

  test("[PCG3-E2E-05] đối chứng dương: cơ sở đã bật ⇒ có nút ghi; giao trực từ ô trống ⇒ dòng trực ACCEPTED nguồn TAY", async ({ page }) => {
    await login(page, { email: EMAIL[4] });
    await moTuan(page, CS2);
    await o(page, "GV Bình", T5, "S").click();
    await panel(page).getByRole("button", { name: "Giao ca trực" }).click();
    await expect(page.getByText(/Đã giao trực 1 buổi/)).toBeVisible();
    const d = await db.operationsDutyAssignment.findFirstOrThrow({ where: { userId: gv.binh, workDate: new Date(`${T5}T00:00:00Z`) } });
    expect(d).toMatchObject({ shiftCode: "S", status: "ACCEPTED", nguonGiao: "TAY" });
    // Panel không phủ lưới ⇒ ô đọc được NGAY, không cần đóng panel.
    await expect(o(page, "GV Bình", T5, "S")).toHaveAccessibleName(/: T$/);
    await expect(panel(page).getByRole("button", { name: "Gỡ ca trực" })).toBeVisible();
    // Tự xếp mặc định TẮT ở cơ sở ⇒ panel KHÔNG hứa "sẽ tự xếp cho GV này" (luật 12).
    await expect(panel(page).locator('[data-tu-xep="tat"]')).toBeVisible();
    await expect(panel(page).locator('[data-tu-xep="bat"]')).toHaveCount(0);
  });

  test("[PCG3-E2E-06] giao trợ giảng từ ô TRỐNG của người khác ⇒ phân công TAY, ô đổi mã", async ({ page }) => {
    await login(page, { email: EMAIL[5] });
    await moTuan(page, CS2);
    await o(page, "GV Chi", T4, "C").click();
    // Panel GV × buổi liệt kê MỌI lớp của cơ sở trong buổi, không chỉ việc của Chi (Chi chưa có việc gì).
    await expect(panel(page).locator("[data-buoi]")).toHaveCount(2);
    await theBuoi(page, `Lớp B pcg3|${T4}`).getByRole("button", { name: "Giao trợ giảng" }).click();
    await expect(page.getByText(/Đã giao 1 buổi/)).toBeVisible();
    const pc = await db.sessionStaffAssignment.findFirstOrThrow({ where: { userId: gv.chi, sourceId: buoi[`Lớp B pcg3|${T4}`]!, status: "ACCEPTED" } });
    expect(pc).toMatchObject({ role: "TEACHING_ASSISTANT", nguonGiao: "TAY" });
    await expect(o(page, "GV Chi", T4, "C")).toHaveAccessibleName(/: TG/);
    // Đang là trợ giảng ⇒ nút đổi thành "Gỡ trợ giảng"; lớp A chồng giờ ⇒ ghi chú bận + KHÔNG giao đứng chính được.
    await expect(theBuoi(page, `Lớp B pcg3|${T4}`).getByRole("button", { name: "Gỡ trợ giảng" })).toBeVisible();
    await expect(theBuoi(page, `Lớp A pcg3|${T4}`).locator("[data-ban-cung-gio]")).toContainText("Lớp B pcg3 cùng giờ");
    await expect(theBuoi(page, `Lớp A pcg3|${T4}`).getByRole("button", { name: /^Đứng chính \(thay GV An\)$/ })).toBeDisabled();
  });

  test("[PCG3-E2E-07] gỡ trợ giảng ở panel ngày ⇒ dòng CANCELLED nguồn TAY", async ({ page }) => {
    await phanCong(`Lớp B pcg3|${T4}`, gv.chi, "TEACHING_ASSISTANT", "TAY"); // điều kiện: Chi đang là trợ giảng
    await login(page, { email: EMAIL[6] });
    await moTuan(page, CS2);
    await page.getByRole("button", { name: /Buổi trong ngày T4 03\/03/ }).click();
    const the = theBuoi(page, `Lớp B pcg3|${T4}`);
    await the.getByLabel(/Trợ giảng — Lớp B pcg3/).selectOption("");
    await expect(page.getByText(/Đã gỡ 1 buổi/)).toBeVisible();
    expect(await db.sessionStaffAssignment.count({ where: { userId: gv.chi, sourceId: buoi[`Lớp B pcg3|${T4}`]!, status: "CANCELLED", nguonGiao: "TAY" } })).toBe(1);
  });

  test("[PCG3-E2E-08] thay người đứng chính ‘các tuần sau’ ⇒ cả buổi tuần sau đổi; người dạy thay ghi trên buổi gốc", async ({ page }) => {
    await login(page, { email: EMAIL[7] });
    await moTuan(page, CS2);
    await page.getByRole("button", { name: /Buổi trong ngày T4 03\/03/ }).click();
    // Tới hết THÁNG ĐANG XEM (03/2027) — 10/03 cùng tháng nên được rải.
    await panel(page).getByRole("button", { name: "Buổi này + các tuần sau (tới 31/03)" }).click();
    await theBuoi(page, `Lớp A pcg3|${T4}`).getByLabel(/Đứng chính — Lớp A pcg3/).selectOption({ label: "GV Bình" });
    await expect(page.getByText(/Đã giao 2 buổi/)).toBeVisible();
    for (const n of [T4, T4_SAU]) {
      const id = buoi[`Lớp A pcg3|${n}`]!;
      expect(await db.sessionStaffAssignment.findFirstOrThrow({ where: { sourceId: id, role: "MAIN_TEACHER", status: "ACCEPTED" } })).toMatchObject({ userId: gv.binh, nguonGiao: "TAY" });
      expect((await db.classSession.findUniqueOrThrow({ where: { id } })).substituteTeacherId).toBe(gv.binh);
    }
  });
  test("[PCG4-E2E-01] Áp khung: xem trước KHÔNG ghi gì; áp thật chép trực của tuần mẫu sang tuần sau, nguồn AP_KHUNG; hộp vừa màn 375px", async ({ page }) => {
    // Điều kiện: tuần mẫu có Bình trực ca Sáng thứ Năm.
    await db.operationsDutyAssignment.create({ data: { userId: gv.binh, centerId: CS2, workDate: new Date(`${T5}T00:00:00Z`), shiftCode: "S", policyVersionId: "cpv_sr_qd_238", nguonGiao: "TAY", status: "ACCEPTED" } });
    await login(page, { email: EMAIL[0] });
    await moTuan(page, CS2);
    const ngaySau = new Date("2027-03-11T00:00:00Z");
    await page.getByRole("button", { name: "Áp khung" }).click();
    const dlg = page.getByRole("dialog");
    await dlg.getByRole("button", { name: "Xem trước" }).click();
    await expect(dlg.locator("[data-xem-truoc]")).toContainText("chưa ghi gì");
    expect(await db.operationsDutyAssignment.count({ where: { userId: gv.binh, workDate: ngaySau } })).toBe(0);
    await dlg.getByRole("button", { name: "Áp thật" }).click();
    await expect(page.getByText(/Đã áp khung/)).toBeVisible();
    expect(await db.operationsDutyAssignment.findFirstOrThrow({ where: { userId: gv.binh, workDate: ngaySau } })).toMatchObject({ shiftCode: "S", status: "ACCEPTED", nguonGiao: "AP_KHUNG" });
    // 375px (cùng phiên — thêm một lượt đăng nhập là chạm giới hạn 10 lượt/phút của máy chủ dev): hộp vừa màn, Xem trước bấm được.
    await page.setViewportSize({ width: 375, height: 812 });
    await page.reload();
    await page.getByRole("button", { name: "Áp khung" }).click();
    await expect.poll(async () => { const h = await page.getByRole("dialog").boundingBox(); return !!h && h.x >= 0 && h.x + h.width <= 376; }).toBe(true);
    await page.getByRole("dialog").getByRole("button", { name: "Xem trước" }).click();
    await expect(page.getByRole("dialog").locator("[data-xem-truoc]")).toBeVisible();
  });

  test("[PCG7-E2E-01] ô TRỐNG → panel liệt kê lớp của cơ sở trong buổi → 'Đứng chính (thay …)' ⇒ ô hiện D; desktop panel nằm CẠNH lưới", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await login(page, { email: EMAIL[9] });
    await moTuan(page, CS2);
    const truoc = o(page, "GV Bình", T4, "C");
    await expect(truoc).toHaveAccessibleName(/: X$/);
    await expect(truoc).toContainText("+ Giao");
    await truoc.click();
    const p = panel(page);
    await expect(p.locator("[data-kicker]")).toHaveText("Thứ Tư 03/03 · Buổi Chiều");
    await expect(p.getByRole("heading", { name: "GV Bình" })).toBeVisible();
    await expect(p).toContainText("2 lớp trong buổi");
    await expect(p.locator("[data-ma-o]")).toContainText("Chưa giao gì trong buổi này");
    // Desktop: panel là cột BÊN PHẢI lưới, không phủ.
    const h = (await p.boundingBox())!;
    const l = (await page.locator('[data-luoi="phan-cong-gop"]').locator("xpath=..").boundingBox())!;
    expect(h.x).toBeGreaterThanOrEqual(l.x + l.width - 1);
    await theBuoi(page, `Lớp B pcg3|${T4}`).getByRole("button", { name: "Đứng chính (thay GV An)" }).click();
    await expect(page.getByText(/Đã giao 1 buổi/)).toBeVisible();
    await expect(o(page, "GV Bình", T4, "C")).toHaveAccessibleName(/: D$/);
    await expect(p.locator("[data-ma-o]")).toContainText("Đứng chính");
    await expect(theBuoi(page, `Lớp B pcg3|${T4}`).getByRole("button", { name: "Gỡ đứng chính" })).toBeVisible();
    expect(await db.sessionStaffAssignment.findFirstOrThrow({ where: { sourceId: buoi[`Lớp B pcg3|${T4}`]!, role: "MAIN_TEACHER", status: "ACCEPTED" } })).toMatchObject({ userId: gv.binh, nguonGiao: "TAY" });
    // Bấm ô KHÁC ⇒ panel đổi nội dung, không cần đóng.
    await o(page, "GV Chi", T4, "C").click();
    await expect(p.getByRole("heading", { name: "GV Chi" })).toBeVisible();
    // Hàng "Lớp & trực trong buổi": chip đọc đúng số; bấm ⇒ panel cả buổi, bật trực cho Chi bằng chip.
    const chip = page.locator('[data-chip-buoi="2027-03-03.C"]');
    await expect(chip).toContainText("Chiều · 2 lớp");
    await expect(chip).toContainText("chưa ai trực");
    await chip.click();
    await expect(p.locator("[data-panel-buoi]")).toBeVisible();
    await p.locator(`[data-chip-truc="${gv.chi}"]`).click();
    await expect(page.getByText(/Đã giao trực 1 buổi/)).toBeVisible();
    await expect(p.locator(`[data-chip-truc="${gv.chi}"]`)).toHaveAttribute("aria-pressed", "true");
    await expect(chip).toContainText("1 GV trực");
    await p.getByRole("button", { name: "Xong" }).click();
    await expect(p.locator("[data-panel-trong]")).toBeVisible();
  });

});
