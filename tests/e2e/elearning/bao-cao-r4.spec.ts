/**
 * [R4-E2E-*] P8 · Báo cáo Theo phòng ban / đơn vị-cơ sở (thiết kế `QtPhongBan` + `QtPhongBanCoSo`): HAI TAB, số liệu THẬT từ ảnh chụp lúc giao (DB),
 * ngưỡng báo động (M2 < 70%, M3 > 20%), ẩn danh nhóm < 5 người, quyền. Ảnh ở `E:\tmp\r4-shots` — KHÔNG phải VISUAL_VERIFIED.
 */
import { mkdirSync } from "node:fs";
import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { login } from "../_helpers/auth";
import { seedUser } from "../_helpers/seed";
import { db } from "../../../lib/db";
import { dungVongHoc, type BoDuLieu } from "./_helpers/seed-elearning";

test.describe.configure({ mode: "serial" });

const ANH = "E:/tmp/r4-shots";
const P = "e2e-el-r4-";
const PB_LON = "E2E_EL_PB_LON"; // 5 người: 3 xong đúng hạn + 2 quá hạn chưa mở bài ⇒ M2 60% (báo động), M3 40% (báo động)
const PB_NHO = "E2E_EL_PB_NHO"; // 2 người ⇒ phải bị GỘP, không có dòng riêng
let d: BoDuLieu;
const cookie = new Map<string, Awaited<ReturnType<BrowserContext["cookies"]>>>();

async function don() {
  const u = await db.user.findMany({ where: { email: { startsWith: P } }, select: { id: true } });
  const ids = u.map((x) => x.id);
  await db.trnEnrollment.deleteMany({ where: { userId: { in: ids } } });
  await db.user.deleteMany({ where: { id: { in: ids } } });
  await db.departmentDef.deleteMany({ where: { code: { in: [PB_LON, PB_NHO] } } });
}

test.beforeAll(async ({ browser }) => {
  d = await dungVongHoc();
  await don();
  mkdirSync(ANH, { recursive: true });
  const goc = await db.trnEnrollment.findUniqueOrThrow({ where: { id: d.enrollmentId }, select: { centerId: true, orgUnitId: true, courseId: true } });
  const pbLon = await db.departmentDef.create({ data: { code: PB_LON, name: "E2E Phòng lớn" }, select: { id: true } });
  const pbNho = await db.departmentDef.create({ data: { code: PB_NHO, name: "E2E Phòng nhỏ" }, select: { id: true } });
  const ngay = (n: number) => new Date(Date.now() + n * 86_400_000);
  const them = async (i: number, phongId: string, kieu: "dung-han" | "bo-trang") => {
    const u = await seedUser({ email: `${P}${i}@satarobo.vn`, name: `E2E R4 ${i}`, role: "TEACHER" });
    await db.trnEnrollment.create({
      data: {
        courseId: goc.courseId,
        userId: u.id,
        cycle: 1,
        status: kieu === "dung-han" ? "COMPLETED" : "OVERDUE",
        dueAt: kieu === "dung-han" ? ngay(10) : ngay(-5),
        dueAtOriginal: kieu === "dung-han" ? ngay(10) : ngay(-5),
        startedAt: kieu === "dung-han" ? ngay(-8) : null,
        verifiedAt: kieu === "dung-han" ? ngay(-2) : null,
        completedAt: kieu === "dung-han" ? ngay(-2) : null,
        progressPercent: kieu === "dung-han" ? 100 : 0,
        centerId: goc.centerId,
        orgUnitId: goc.orgUnitId,
        source: "ASSIGNMENT",
        snapJobTitle: "Nhân viên",
        snapDepartmentId: phongId,
        snapOrgUnitId: goc.orgUnitId,
      },
    });
  };
  for (let i = 1; i <= 3; i++) await them(i, pbLon.id, "dung-han");
  for (let i = 4; i <= 5; i++) await them(i, pbLon.id, "bo-trang");
  for (let i = 6; i <= 7; i++) await them(i, pbNho.id, "dung-han");
  for (const email of [d.daoTaoEmail, d.hocVienEmail]) {
    const ctx = await browser.newContext();
    const p = await ctx.newPage();
    await login(p, { email, callbackUrl: "/elearning" });
    await expect(p).toHaveURL(/\/elearning/);
    cookie.set(email, await ctx.cookies());
    await ctx.close();
  }
});
test.afterAll(don);

async function vao(page: Page, email: string, duongDan: string) {
  // Rời trang cũ TRƯỚC khi đổi cookie: yêu cầu nền của trang cũ (làm mới phiên) về muộn sẽ ghi đè cookie mới (D-51).
  await page.goto("about:blank");
  await page.context().clearCookies();
  await page.context().addCookies(cookie.get(email)!);
  await page.goto(duongDan);
  await page.addStyleTag({ content: "nextjs-portal{display:none!important}" });
}
const chup = async (page: Page, ten: string) => {
  const toi = await page.evaluate(() => matchMedia("(prefers-color-scheme: dark)").matches);
  await page.screenshot({ path: `${ANH}/${ten}-${page.viewportSize()?.width ?? 0}${toi ? "-dark" : ""}.png`, fullPage: true });
};
const khongTranNgang = async (page: Page) => {
  const du = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  expect(du, `trang dư ${du}px ở khổ ${page.viewportSize()?.width}`).toBeLessThanOrEqual(1);
};

test("[R4-E2E-01] 🔴 tab 'Theo phòng ban': số liệu THẬT của nhóm 5 người (Người 5 · Lượt 5 · M2 60% báo động · M3 40% báo động · M5 chưa đo được), thanh M2 có nhãn đọc được; chú thích nói M5 là XẤP XỈ; không tràn ngang", async ({ page }) => {
  await vao(page, d.daoTaoEmail, "/elearning/bao-cao-r4");
  await expect(page.getByRole("heading", { name: "Theo phòng ban", exact: true })).toBeVisible();
  const dong = page.getByRole("row", { name: /E2E Phòng lớn/ });
  await expect(dong).toBeVisible();
  const o = dong.getByRole("cell");
  await expect(o.nth(1)).toHaveText("5"); // người
  await expect(o.nth(2)).toHaveText("5"); // lượt
  await expect(o.nth(3)).toContainText("60% · báo động");
  await expect(dong.getByRole("progressbar", { name: /đúng hạn của E2E Phòng lớn: 60%/ })).toBeVisible();
  await expect(o.nth(4)).toContainText("40% · báo động");
  await expect(o.nth(5)).toContainText("chưa đo được"); // không ai đang học còn hạn ⇒ KHÔNG in 0%
  await expect(page.getByText(/M5 là số XẤP XỈ/)).toBeVisible();
  await chup(page, "r4-phong-ban");
  await khongTranNgang(page);
});

test("[R4-E2E-02] 🔴 ẩn danh: nhóm 2 người KHÔNG có dòng riêng — gộp vào 'Khối hỗ trợ' (đối chứng dương: nhóm 5 người có dòng riêng)", async ({ page }) => {
  await vao(page, d.daoTaoEmail, "/elearning/bao-cao-r4");
  await expect(page.getByRole("row", { name: /E2E Phòng lớn/ })).toBeVisible();
  await expect(page.getByRole("row", { name: /Khối hỗ trợ/ })).toBeVisible();
  await expect(page.getByText("E2E Phòng nhỏ")).toHaveCount(0);
});

test("[R4-E2E-03] chuyển tab: 'Theo đơn vị / cơ sở' có URL riêng (?tab=co-so), bảng đơn vị có nhóm ≥ 5 người; liên kết CŨ ?theo=co-so vẫn mở đúng tab; tab phòng ban không còn hiện", async ({ page }) => {
  await vao(page, d.daoTaoEmail, "/elearning/bao-cao-r4");
  await page.getByRole("link", { name: /Theo đơn vị \/ cơ sở/ }).click();
  await expect(page).toHaveURL(/tab=co-so/);
  await expect(page.getByRole("region", { name: "Theo đơn vị / cơ sở" })).toBeVisible();
  await expect(page.getByRole("row", { name: /E2E Phòng lớn/ })).toHaveCount(0);
  const soNguoi = Number(await page.getByRole("region", { name: "Theo đơn vị / cơ sở" }).getByRole("row").nth(1).getByRole("cell").nth(1).innerText());
  expect(soNguoi).toBeGreaterThanOrEqual(5);
  await chup(page, "r4-co-so");
  await vao(page, d.daoTaoEmail, "/elearning/bao-cao-r4?theo=co-so");
  await expect(page.getByRole("link", { name: /Theo đơn vị \/ cơ sở/ })).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("region", { name: "Theo đơn vị / cơ sở" })).toBeVisible();
});

test("[R4-E2E-04] 🔴 người học thuần bị CHẶN (không thấy số liệu của ai)", async ({ page }) => {
  await vao(page, d.hocVienEmail, "/elearning/bao-cao-r4");
  await expect(page.getByText(/elearning:progress:view-all/).first()).toBeVisible();
  await expect(page.getByRole("row", { name: /E2E Phòng lớn/ })).toHaveCount(0);
  await expect(page.getByRole("progressbar")).toHaveCount(0);
});
