/**
 * [KCH-E2E-*] P8 · Ngân hàng câu hỏi (thiết kế `QtCauHoi`): cây nhánh có đếm, ba tab (Mọi dạng · Máy chấm · Người chấm), "% đúng" từ lượt đã chấm (ngưỡng 5 lượt),
 * "đã dùng trong N đề", Sửa khoá khi câu đã vào đề, CHỌN NHIỀU → CHUYỂN NHÁNH / NHÂN BẢN thật (DB), quyền. Ảnh `E:\tmp\kch-shots` — KHÔNG phải VISUAL_VERIFIED.
 */
import { mkdirSync } from "node:fs";
import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { login } from "../_helpers/auth";
import { seedUser } from "../_helpers/seed";
import { db } from "../../../lib/db";
import { dungVongHoc, type BoDuLieu } from "./_helpers/seed-elearning";

test.describe.configure({ mode: "serial" });

const ANH = "E:/tmp/kch-shots";
const P = "e2e-el-kch-";
const GOC = "/e2e-el-kch/";
const TIEN_TO_DE = "E2E_EL_KCH_";
let d: BoDuLieu;
const id: Record<"a1" | "a2" | "a3" | "a4", string> = { a1: "", a2: "", a3: "", a4: "" };
const cookie = new Map<string, Awaited<ReturnType<BrowserContext["cookies"]>>>();

async function don() {
  const de = await db.trnExam.findMany({ where: { title: { startsWith: TIEN_TO_DE } }, select: { id: true } });
  const ids = de.map((x) => x.id);
  await db.trnExamAnswer.deleteMany({ where: { attempt: { examId: { in: ids } } } });
  await db.trnExamAttempt.deleteMany({ where: { examId: { in: ids } } });
  await db.trnExamQuestion.deleteMany({ where: { examId: { in: ids } } });
  await db.trnExam.deleteMany({ where: { id: { in: ids } } });
  await db.trnChoice.deleteMany({ where: { question: { bankPath: { startsWith: GOC } } } });
  await db.trnQuestion.deleteMany({ where: { bankPath: { startsWith: GOC } } });
  const u = await db.user.findMany({ where: { email: { startsWith: P } }, select: { id: true } });
  await db.user.deleteMany({ where: { id: { in: u.map((x) => x.id) } } });
}

test.beforeAll(async ({ browser }) => {
  d = await dungVongHoc();
  await don();
  mkdirSync(ANH, { recursive: true });
  const cs = await db.trnEnrollment.findUniqueOrThrow({ where: { id: d.enrollmentId }, select: { centerId: true, orgUnitId: true } });
  const C = { centerId: cs.centerId as string, orgUnitId: cs.orgUnitId as string };
  const cau = async (bankPath: string, type: "SINGLE" | "ESSAY" | "MATCHING", stem: string) =>
    (
      await db.trnQuestion.create({
        data: {
          bankPath,
          type,
          stem,
          contentJson: {},
          defaultPoints: 1,
          ...C,
          ...(type === "SINGLE" ? { choices: { create: [{ text: "Đáp án A", isCorrect: false, orderIndex: 0 }, { text: "Đáp án B", isCorrect: true, orderIndex: 1 }] } } : {}),
        },
        select: { id: true },
      })
    ).id;
  id.a1 = await cau(`${GOC}nv/an-toan/`, "SINGLE", "Chọn thiết bị bảo hộ đúng khi sạc pin");
  id.a2 = await cau(`${GOC}nv/an-toan/`, "SINGLE", "Chọn thứ tự ngắt điện an toàn");
  id.a3 = await cau(`${GOC}nv/an-toan/dien/`, "ESSAY", "Mô tả cách xử lý khi lớp có mùi khét");
  id.a4 = await cau(`${GOC}hv/robo/`, "MATCHING", "Ghép mỗi bộ phận với việc nó làm");
  // a1: nằm trong MỘT đề với 5 lượt đã chấm (3 đúng ⇒ 60%). a2: nằm trong đề với chỉ 2 lượt (⇒ "—", chưa đủ để kết luận).
  const de = await db.trnExam.create({ data: { title: `${TIEN_TO_DE}Đề`, durationMin: 10, passScore: 1, maxScore: 2, isActive: true }, select: { id: true } });
  const eq1 = (await db.trnExamQuestion.create({ data: { examId: de.id, questionId: id.a1, orderIndex: 1, points: 1 }, select: { id: true } })).id;
  const eq2 = (await db.trnExamQuestion.create({ data: { examId: de.id, questionId: id.a2, orderIndex: 2, points: 1 }, select: { id: true } })).id;
  for (let i = 0; i < 5; i++) {
    const u = await seedUser({ email: `${P}${i + 1}@satarobo.vn`, name: `E2E KCH ${i + 1}`, role: "TEACHER" });
    const a = await db.trnExamAttempt.create({
      data: { examId: de.id, userId: u.id, attemptNo: 1, status: "GRADED", startedAt: new Date(Date.now() - 86_400_000), submittedAt: new Date(Date.now() - 86_000_000), gradedAt: new Date(), totalScore: 1, passed: true, purgeAfter: new Date(Date.now() + 90 * 86_400_000), ...C },
      select: { id: true },
    });
    await db.trnExamAnswer.create({ data: { attemptId: a.id, examQuestionId: eq1, selectedChoiceIds: ["1"], score: i < 3 ? 1 : 0, isCorrect: i < 3 } });
    if (i < 2) await db.trnExamAnswer.create({ data: { attemptId: a.id, examQuestionId: eq2, selectedChoiceIds: ["1"], score: 1, isCorrect: true } });
  }
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
const cayNhanh = (page: Page) => page.getByRole("navigation", { name: "Nhánh kho câu hỏi" });
const dong = (page: Page, stem: string) => page.getByRole("row", { name: new RegExp(stem) });
const URL_NHANH = `/elearning/kho-cau-hoi?nhanh=${encodeURIComponent(GOC)}`;

test("[KCH-E2E-01] 🔴 cây nhánh có ĐẾM (gồm nhánh con) và tab theo cách chấm: nhánh gốc 4 câu = Mọi dạng 4 · Máy chấm 2 · Người chấm 1 (loại chưa mở chỉ ở 'Mọi dạng'); không tràn ngang", async ({ page }) => {
  await vao(page, d.daoTaoEmail, URL_NHANH);
  await expect(page.getByRole("heading", { name: "Ngân hàng câu hỏi", exact: true })).toBeVisible();
  const goc = cayNhanh(page).locator(`a[href*="${encodeURIComponent(GOC)}"]`).first();
  await expect(goc).toContainText("4");
  await expect(goc).toHaveAttribute("aria-current", "true");
  await expect(cayNhanh(page).locator(`a[href$="${encodeURIComponent(`${GOC}nv/`)}"], a[href*="${encodeURIComponent(`${GOC}nv/`)}&"]`).first()).toContainText("3");
  await expect(cayNhanh(page).locator(`a[href*="${encodeURIComponent(`${GOC}nv/an-toan/dien/`)}"]`).first()).toContainText("1");
  const tabs = page.getByRole("navigation", { name: "Lọc theo cách chấm" });
  await expect(tabs.getByRole("link", { name: /Mọi dạng/ })).toContainText("4");
  await expect(tabs.getByRole("link", { name: /Máy chấm/ })).toContainText("2");
  await expect(tabs.getByRole("link", { name: /Người chấm/ })).toContainText("1");
  await chup(page, "kch-danh-sach");
  await khongTranNgang(page);
});

test("[KCH-E2E-02] 🔴 '% đúng' từ lượt ĐÃ CHẤM: câu 5 lượt (3 đúng) = 60%; câu mới 2 lượt = '—' (không in 100% từ hai người); 'đã dùng trong 1 đề'", async ({ page }) => {
  await vao(page, d.daoTaoEmail, URL_NHANH);
  const a1 = dong(page, "Chọn thiết bị bảo hộ đúng khi sạc pin");
  await expect(a1.getByRole("cell").nth(4)).toHaveText("60%");
  await expect(a1).toContainText("đã dùng trong 1 đề");
  await expect(a1.getByRole("cell").nth(2)).toHaveText("Chọn một");
  const a2 = dong(page, "Chọn thứ tự ngắt điện an toàn");
  await expect(a2.getByRole("cell").nth(4)).toHaveText("—");
  await expect(dong(page, "Mô tả cách xử lý khi lớp có mùi khét").getByRole("cell").nth(4)).toHaveText("—"); // chưa ở đề nào
  await expect(dong(page, "Mô tả cách xử lý khi lớp có mùi khét")).not.toContainText("đã dùng trong");
});

test("[KCH-E2E-03] tab 'Máy chấm' chỉ có trắc nghiệm, 'Người chấm' chỉ có tự luận; loại chưa mở (Ghép cặp) chỉ ở 'Mọi dạng'", async ({ page }) => {
  await vao(page, d.daoTaoEmail, `${URL_NHANH}&tab=may-cham`);
  await expect(dong(page, "Chọn thiết bị bảo hộ")).toBeVisible();
  await expect(dong(page, "Mô tả cách xử lý")).toHaveCount(0);
  await expect(dong(page, "Ghép mỗi bộ phận")).toHaveCount(0);
  await vao(page, d.daoTaoEmail, `${URL_NHANH}&tab=nguoi-cham`);
  await expect(dong(page, "Mô tả cách xử lý")).toBeVisible();
  await expect(dong(page, "Chọn thiết bị bảo hộ")).toHaveCount(0);
  await vao(page, d.daoTaoEmail, URL_NHANH);
  await expect(dong(page, "Ghép mỗi bộ phận")).toBeVisible();
  await expect(dong(page, "Ghép mỗi bộ phận").getByRole("cell").nth(2)).toHaveText("Ghép cặp");
});

test("[KCH-E2E-04] 🔴 nút 'Sửa' KHOÁ với câu đã nằm trong đề (kèm lý do) và MỞ với câu chưa vào đề", async ({ page }) => {
  await vao(page, d.daoTaoEmail, URL_NHANH);
  const khoa = dong(page, "Chọn thiết bị bảo hộ").getByRole("button", { name: "Sửa" });
  await expect(khoa).toBeDisabled();
  await expect(khoa).toHaveAttribute("title", /nhân bản thay vì sửa/);
  await expect(dong(page, "Mô tả cách xử lý").getByRole("button", { name: "Sửa" })).toBeEnabled();
});

test("[KCH-E2E-05] 🔴 NHÂN BẢN thật: chọn 1 câu → 'Nhân bản' ⇒ DB có thêm đúng 1 câu cùng đề bài thuộc người nhân bản, câu gốc giữ nguyên", async ({ page }) => {
  const dem = () => db.trnQuestion.count({ where: { bankPath: { startsWith: GOC }, stem: "Mô tả cách xử lý khi lớp có mùi khét", deletedAt: null } });
  expect(await dem()).toBe(1);
  await vao(page, d.daoTaoEmail, URL_NHANH);
  await page.getByRole("checkbox", { name: /Chọn câu: Mô tả cách xử lý khi lớp có mùi khét/ }).check();
  await expect(page.getByText("Đã chọn 1 câu")).toBeVisible();
  await page.getByRole("button", { name: "Nhân bản", exact: true }).click();
  await expect.poll(dem, { timeout: 30_000 }).toBe(2);
  const bans = await db.trnQuestion.findMany({ where: { bankPath: { startsWith: GOC }, stem: "Mô tả cách xử lý khi lớp có mùi khét" }, select: { id: true, createdByUserId: true, bankPath: true, type: true } });
  const moi = bans.find((b) => b.id !== id.a3)!;
  expect(moi.createdByUserId).toBe(d.daoTaoId);
  expect(moi.bankPath).toBe(`${GOC}nv/an-toan/dien/`);
  expect(moi.type).toBe("ESSAY");
  await expect(page.getByText("Chưa chọn câu nào")).toBeVisible({ timeout: 20_000 }); // chọn bị bỏ sau khi xong
  await expect(page.getByRole("row", { name: /Mô tả cách xử lý khi lớp có mùi khét/ })).toHaveCount(2, { timeout: 20_000 });
});

test("[KCH-E2E-06] 🔴 CHUYỂN NHÁNH thật: chọn 2 câu (kể cả câu đã vào đề) → 'Chuyển nhánh' → nhánh mới ⇒ DB đổi cả hai, câu khác giữ nguyên; nhánh sai dạng bị khoá nút", async ({ page }) => {
  const dich = `${GOC}da-chuyen/`;
  await vao(page, d.daoTaoEmail, URL_NHANH);
  await page.getByRole("checkbox", { name: /Chọn câu: Chọn thiết bị bảo hộ/ }).check();
  await page.getByRole("checkbox", { name: /Chọn câu: Chọn thứ tự ngắt điện/ }).check();
  await expect(page.getByText("Đã chọn 2 câu")).toBeVisible();
  await page.getByRole("button", { name: "Chuyển nhánh", exact: true }).click();
  await page.getByLabel("Nhánh đích").fill("khong-co-gach");
  await expect(page.getByRole("button", { name: "Chuyển", exact: true })).toBeDisabled();
  await page.getByLabel("Nhánh đích").fill(dich);
  await page.getByRole("button", { name: "Chuyển", exact: true }).click();
  const nhanh = async (x: string) => (await db.trnQuestion.findUniqueOrThrow({ where: { id: x }, select: { bankPath: true } })).bankPath;
  await expect.poll(() => nhanh(id.a1), { timeout: 30_000 }).toBe(dich);
  expect(await nhanh(id.a2)).toBe(dich);
  expect(await nhanh(id.a4)).toBe(`${GOC}hv/robo/`); // câu không chọn giữ nguyên
  await expect(cayNhanh(page).locator(`a[href*="${encodeURIComponent(dich)}"]`).first()).toContainText("2", { timeout: 20_000 });
  await chup(page, "kch-sau-chuyen");
});

test("[KCH-E2E-07] 🔴 người học thuần bị CHẶN (không thấy kho, cả cây nhánh)", async ({ page }) => {
  await vao(page, d.hocVienEmail, URL_NHANH);
  await expect(page.getByText(/elearning:content:author/).first()).toBeVisible();
  await expect(cayNhanh(page)).toHaveCount(0);
  await expect(page.getByText("Chọn thiết bị bảo hộ")).toHaveCount(0);
});
