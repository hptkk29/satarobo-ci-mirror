/**
 * [CBT-E2E-*] P8 · Chấm bài tập master-detail (thiết kế `QtChamBai`): danh sách trái / khung chấm phải, chuyển bài, tìm kiếm, CHỐT ĐIỂM THẬT (DB), quyền,
 * tab Online nói thẳng là chưa có luồng (không đọc Trn*). Ảnh ở `E:\tmp\cbt-shots` để so thiết kế — KHÔNG phải VISUAL_VERIFIED.
 */
import { mkdirSync } from "node:fs";
import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { login } from "../_helpers/auth";
import { seedUser } from "../_helpers/seed";
import { db } from "../../../lib/db";
import { dungKhoaBaiTap, donKhoaBaiTap, dungVongHoc, type BoBaiTap, type BoDuLieu } from "./_helpers/seed-elearning";

test.describe.configure({ mode: "serial" });

const ANH = "E:/tmp/cbt-shots";
const EMAIL_HAI = "e2e-el-cbt-hai@satarobo.vn";
let d: BoDuLieu;
let bt: BoBaiTap;
let idHai = "";
let idMot = "";
const cookie = new Map<string, Awaited<ReturnType<BrowserContext["cookies"]>>>();

async function don() {
  await donKhoaBaiTap();
  const u = await db.user.findMany({ where: { email: EMAIL_HAI }, select: { id: true } });
  if (u.length) {
    await db.trnSubmission.deleteMany({ where: { userId: { in: u.map((x) => x.id) } } });
    await db.trnEnrollment.deleteMany({ where: { userId: { in: u.map((x) => x.id) } } });
    await db.user.deleteMany({ where: { id: { in: u.map((x) => x.id) } } });
  }
}

test.beforeAll(async ({ browser }) => {
  d = await dungVongHoc();
  await don();
  bt = await dungKhoaBaiTap(d);
  mkdirSync(ANH, { recursive: true });
  const goc = await db.trnEnrollment.findUniqueOrThrow({ where: { id: bt.enrollmentId }, select: { centerId: true, orgUnitId: true, dueAt: true } });
  const sub = await db.trnSubmission.findUniqueOrThrow({ where: { id: bt.submissionNhapId }, select: { rubricId: true, lessonId: true } });
  // Bài 1: người học e2e nộp (chuyển nháp → đã nộp), hạn chấm còn 3 giờ.
  await db.trnSubmission.update({ where: { id: bt.submissionNhapId }, data: { status: "SUBMITTED", contentText: "Nội dung bài nộp thứ nhất", submittedAt: new Date(), dueGradeAt: new Date(Date.now() + 3 * 3600_000) } });
  idMot = bt.submissionNhapId;
  // Bài 2: người học thứ hai, hạn chấm còn ~2 ngày.
  const u2 = await seedUser({ email: EMAIL_HAI, name: "E2E Học Hai", role: "TEACHER" });
  const ge2 = await db.trnEnrollment.create({
    data: { courseId: bt.courseId, userId: u2.id, cycle: 1, status: "NOT_STARTED", dueAt: goc.dueAt, dueAtOriginal: goc.dueAt, centerId: goc.centerId, orgUnitId: goc.orgUnitId, source: "ASSIGNMENT", snapJobTitle: "Nhân viên" },
    select: { id: true },
  });
  const s2 = await db.trnSubmission.create({
    data: { lessonId: sub.lessonId, enrollmentId: ge2.id, userId: u2.id, attemptNo: 1, status: "SUBMITTED", rubricId: sub.rubricId, contentText: "Nội dung bài nộp thứ hai", submittedAt: new Date(), dueGradeAt: new Date(Date.now() + 50 * 3600_000), centerId: goc.centerId as string, orgUnitId: goc.orgUnitId as string },
    select: { id: true },
  });
  idHai = s2.id;
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
const danhSach = (page: Page) => page.getByRole("region", { name: "Bài đang chờ chấm" });
const khungCham = (page: Page) => page.getByRole("region", { name: "Khung chấm" });

test("[CBT-E2E-01] 🔴 master-detail: danh sách hai bài (hạn sớm trước, có nhãn 'Còn 3 giờ'), bài đầu được chọn sẵn và khung chấm bên phải hiện đúng bài; không tràn ngang", async ({ page }) => {
  await vao(page, d.daoTaoEmail, "/elearning/cham-bai-tap");
  await expect(page.getByRole("heading", { name: "Chấm bài tập và sản phẩm", exact: true })).toBeVisible();
  const tabs = page.getByRole("navigation", { name: "Nguồn bài chờ chấm" });
  await expect(tabs.getByRole("link", { name: /Tất cả/ })).toHaveAttribute("aria-current", "page");
  const muc = danhSach(page).getByRole("link");
  await expect(muc).toHaveCount(2);
  await expect(muc.first()).toContainText("Còn 3 giờ");
  await expect(muc.first()).toHaveAttribute("aria-current", "true");
  await expect(khungCham(page).getByRole("heading", { name: "E2E Bài tập nộp tệp" })).toBeVisible();
  await expect(khungCham(page).getByText("Nội dung bài nộp thứ nhất")).toBeVisible();
  await chup(page, "cbt-master-detail");
  await khongTranNgang(page);
});

test("[CBT-E2E-02] chuyển bài: bấm bài thứ hai ⇒ URL có ?id=, khung chấm đổi sang nội dung bài hai; tìm kiếm lọc danh sách", async ({ page }) => {
  await vao(page, d.daoTaoEmail, "/elearning/cham-bai-tap");
  await danhSach(page).getByRole("link").nth(1).click();
  await expect(page).toHaveURL(new RegExp(`id=${idHai}`));
  await expect(khungCham(page).getByText("Nội dung bài nộp thứ hai")).toBeVisible();
  await expect(khungCham(page).getByText("E2E Học Hai")).toBeVisible();
  await vao(page, d.daoTaoEmail, "/elearning/cham-bai-tap?q=zzzkhong");
  await expect(page.getByText("Không có bài nào khớp")).toBeVisible();
  await vao(page, d.daoTaoEmail, "/elearning/cham-bai-tap?q=Hai");
  await expect(danhSach(page).getByRole("link")).toHaveCount(1);
});

test("[CBT-E2E-03] tab 'Học viên online': nói thẳng chưa có luồng nộp sản phẩm online (miền Online riêng), KHÔNG liệt kê bài nội bộ", async ({ page }) => {
  await vao(page, d.daoTaoEmail, "/elearning/cham-bai-tap?tab=hoc-vien-online");
  await expect(page.getByText("Chưa có luồng nộp sản phẩm cho học viên online")).toBeVisible();
  await expect(page.getByRole("region", { name: "Bài đang chờ chấm" })).toHaveCount(0);
});

test("[CBT-E2E-04] 🔴 người không có quyền chấm bị CHẶN (không thấy bài, không có khung chấm); Đào tạo (đối chứng) thấy", async ({ page }) => {
  await vao(page, d.hocVienEmail, "/elearning/cham-bai-tap");
  await expect(page.getByText(/elearning:exam:grade/).first()).toBeVisible();
  await expect(page.getByRole("region", { name: "Khung chấm" })).toHaveCount(0);
});

test("[CBT-E2E-05] 🔴 CHỐT ĐIỂM thật: chọn mức ⇒ 'Chốt điểm' ⇒ lượt nộp thành GRADED trong DB, bài rời hàng chờ và khung chấm chuyển sang bài kế tiếp", async ({ page }) => {
  await vao(page, d.daoTaoEmail, "/elearning/cham-bai-tap");
  const chot = khungCham(page).getByRole("button", { name: "Chốt điểm" });
  await expect(chot).toBeDisabled(); // chưa chọn mức
  await khungCham(page).getByRole("group", { name: /Chọn mức cho tiêu chí Đủ nội dung/ }).getByRole("button", { name: /Đủ/ }).click();
  await expect(chot).toBeEnabled();
  await chot.click();
  await expect(danhSach(page).getByRole("link")).toHaveCount(1, { timeout: 20_000 });
  expect((await db.trnSubmission.findUniqueOrThrow({ where: { id: idMot }, select: { status: true } })).status).toBe("GRADED");
  expect((await db.trnSubmission.findUniqueOrThrow({ where: { id: idHai }, select: { status: true } })).status).toBe("SUBMITTED");
  await expect(khungCham(page).getByText("Nội dung bài nộp thứ hai")).toBeVisible(); // đã chuyển sang bài kế tiếp
  await expect(page).toHaveURL(new RegExp(`id=${idHai}`));
});
