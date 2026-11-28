/**
 * [DT-E2E-*] P8 · Đề thi (thiết kế `QtDeThi`): bảng "Tạo đề mới" MỞ SẴN, "Các đề" có dòng phụ (câu · dạng · câu chấm tay) + "Gắn vào", HAI MIỀN TÁCH BẠCH
 * (đề nội bộ `TrnExam` / đề khoá online `OnlAssessment` chỉ-đọc), TẠO ĐỀ THẬT (DB), quyền. Ảnh `E:\tmp\dt-shots` — KHÔNG phải VISUAL_VERIFIED.
 */
import { mkdirSync } from "node:fs";
import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { login } from "../_helpers/auth";
import { db } from "../../../lib/db";
import { taoKhoa } from "../../../lib/elearning-online/khoa-hoc";
import { donBangOnl } from "../../elearning/_onl-don";
import { dungVongHoc, type BoDuLieu } from "./_helpers/seed-elearning";

test.describe.configure({ mode: "serial" });

const ANH = "E:/tmp/dt-shots";
const P = "E2E_EL_DT_";
let d: BoDuLieu;
let tenKhoaNoiBo = "";
let khoaOnlineId = "";
const cookie = new Map<string, Awaited<ReturnType<BrowserContext["cookies"]>>>();

async function don() {
  const de = await db.trnExam.findMany({ where: { title: { startsWith: P } }, select: { id: true } });
  const ids = de.map((x) => x.id);
  await db.trnExamQuestion.deleteMany({ where: { examId: { in: ids } } });
  await db.trnExam.deleteMany({ where: { id: { in: ids } } });
  await db.trnQuestion.deleteMany({ where: { bankPath: { startsWith: P } } });
  await donBangOnl(db);
}

test.beforeAll(async ({ browser }) => {
  d = await dungVongHoc();
  await don();
  mkdirSync(ANH, { recursive: true });
  tenKhoaNoiBo = (await db.trnCourse.findUniqueOrThrow({ where: { id: d.courseId }, select: { title: true } })).title;
  const q = (ten: string, type: "SINGLE" | "ESSAY", stem: string) =>
    db.trnQuestion.create({ data: { bankPath: `${P}${ten}`, type, stem, contentJson: {}, defaultPoints: 1 }, select: { id: true } });
  const q1 = await q("a", "SINGLE", "Câu chọn một");
  const q2 = await q("b", "ESSAY", "Câu tự luận");
  const nhap = await db.trnExam.create({ data: { title: `${P}Đề nháp`, courseId: d.courseId, durationMin: 15, passScore: 4, maxScore: 0, isActive: false }, select: { id: true } });
  for (const [i, qq] of [q1, q2].entries()) await db.trnExamQuestion.create({ data: { examId: nhap.id, questionId: qq.id, orderIndex: i + 1, points: 1 } });
  await db.trnExam.create({ data: { title: `${P}Đề kích hoạt`, courseId: d.courseId, durationMin: 20, passScore: 1, maxScore: 2, isActive: true }, select: { id: true } });
  // Miền ONLINE: một khoá + một đề (đối chứng: KHÔNG được lẫn vào bảng nội bộ).
  const t = await taoKhoa(db, { code: `E2E-DT-${Date.now().toString(36).toUpperCase()}`, name: `${P}Khoá RoboSim online`, listPrice: 1, salePrice: 1, validityMonths: 12, renewalEnabled: false }, null);
  if (!t.ok) throw new Error(t.thongBao);
  khoaOnlineId = t.courseId;
  await db.onlAssessment.create({ data: { courseId: khoaOnlineId, kind: "QUIZ", title: `${P}Kiểm tra chặng 2 — RoboSim 1`, passPercent: 70, timeLimitMin: 20, maxAttempts: 2, status: "ACTIVE" } });
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
const noiBo = (page: Page) => page.getByRole("region", { name: /^Các đề \(/ });
const online = (page: Page) => page.getByRole("region", { name: /^Đề của khoá online \(/ });

test("[DT-E2E-01] 🔴 bảng 'Tạo đề mới' MỞ SẴN (không cần bấm nút); 'Các đề': dòng phụ '2 câu · 2 dạng · 1 câu chấm tay', Gắn vào = Khoá nội bộ + tên khoá, đề nháp 'Dựng đề' / đề đã kích hoạt 'Mở' kèm '1/2'; không tràn ngang", async ({ page }) => {
  await vao(page, d.daoTaoEmail, "/elearning/de-thi");
  await expect(page.getByRole("heading", { name: "Đề thi", exact: true })).toBeVisible();
  await expect(page.getByLabel("Tên đề thi")).toBeVisible();
  await expect(page.getByLabel("Thuộc khoá")).toBeVisible();
  await expect(page.getByLabel("Chờ giữa hai lượt (giờ)")).toBeVisible();
  await expect(page.getByRole("button", { name: "Tạo đề", exact: true })).toBeDisabled(); // tên trống
  const nhap = page.getByRole("row", { name: new RegExp(`${P}Đề nháp`) });
  await expect(nhap).toContainText("2 câu · 2 dạng · 1 câu chấm tay");
  await expect(nhap).toContainText("Khoá nội bộ");
  await expect(nhap).toContainText(tenKhoaNoiBo);
  await expect(nhap).toContainText("Nháp");
  await expect(nhap.getByRole("link", { name: /^Dựng đề/ })).toBeVisible();
  const kich = page.getByRole("row", { name: new RegExp(`${P}Đề kích hoạt`) });
  await expect(kich).toContainText("Đã kích hoạt");
  await expect(kich).toContainText("1/2");
  await expect(kich).toContainText("Chưa có câu nào");
  await expect(kich.getByRole("link", { name: /^Mở đề/ })).toBeVisible();
  await chup(page, "dt-danh-sach");
  await khongTranNgang(page);
});

test("[DT-E2E-02] 🔴 HAI MIỀN TÁCH BẠCH: đề của khoá online hiện ở bảng riêng (Khoá online + tên khoá + 'Mở' dẫn sang màn khoá online); KHÔNG lẫn vào bảng nội bộ và khoá online KHÔNG có trong ô 'Thuộc khoá'", async ({ page }) => {
  await vao(page, d.daoTaoEmail, "/elearning/de-thi");
  const dong = online(page).getByRole("row", { name: /Kiểm tra chặng 2 — RoboSim 1/ });
  await expect(dong).toContainText("Khoá online");
  await expect(dong).toContainText(`${P}Khoá RoboSim online`);
  await expect(dong).toContainText("70%");
  await expect(dong.getByRole("link", { name: /^Mở khoá online/ })).toHaveAttribute("href", `/elearning/online/khoa/${khoaOnlineId}`);
  await expect(noiBo(page).getByText(/Kiểm tra chặng 2/)).toHaveCount(0);
  await expect(page.getByLabel("Thuộc khoá").locator("option", { hasText: "RoboSim online" })).toHaveCount(0);
  await expect(page.getByLabel("Thuộc khoá").locator("option", { hasText: tenKhoaNoiBo })).toHaveCount(1); // đối chứng dương
  await chup(page, "dt-hai-mien");
});

test("[DT-E2E-03] 🔴 TẠO ĐỀ THẬT: nhập tên + bấm 'Tạo đề' ⇒ DB có đề nháp gắn đúng khoá, hàng mới hiện 'Nháp · Chưa có câu nào'; bảng vẫn MỞ (tạo tiếp được)", async ({ page }) => {
  await vao(page, d.daoTaoEmail, "/elearning/de-thi");
  await page.getByLabel("Tên đề thi").fill(`${P}Đề tạo từ màn`);
  await page.getByLabel("Thuộc khoá").selectOption({ label: tenKhoaNoiBo }); // chọn khoá tường minh (mặc định là khoá đầu danh sách)
  await page.getByLabel("Thời gian (phút)").fill("25");
  await page.getByRole("button", { name: "Tạo đề", exact: true }).click();
  await expect
    .poll(async () => await db.trnExam.findFirst({ where: { title: `${P}Đề tạo từ màn` }, select: { durationMin: true, isActive: true, courseId: true } }), { timeout: 30_000 })
    .toMatchObject({ durationMin: 25, isActive: false, courseId: d.courseId });
  const moi = page.getByRole("row", { name: new RegExp(`${P}Đề tạo từ màn`) });
  await expect(moi).toContainText("Chưa có câu nào", { timeout: 20_000 });
  await expect(moi).toContainText("Nháp");
  await expect(page.getByLabel("Tên đề thi")).toBeVisible(); // bảng không đóng lại sau khi tạo
});

test("[DT-E2E-04] nút 'Chấm bài thi · …' dẫn tới hàng chờ chấm", async ({ page }) => {
  await vao(page, d.daoTaoEmail, "/elearning/de-thi");
  const nut = page.getByRole("link", { name: /^Chấm bài thi ·/ });
  await expect(nut).toBeVisible();
  await nut.click();
  await expect(page).toHaveURL(/\/elearning\/cham-bai/);
});

test("[DT-E2E-05] 🔴 người học thuần bị CHẶN (không thấy đề nào, cả hai miền)", async ({ page }) => {
  await vao(page, d.hocVienEmail, "/elearning/de-thi");
  await expect(page.getByText(/elearning:content:author/).first()).toBeVisible();
  await expect(noiBo(page)).toHaveCount(0);
  await expect(online(page)).toHaveCount(0);
  await expect(page.getByText(/Kiểm tra chặng 2/)).toHaveCount(0);
});
