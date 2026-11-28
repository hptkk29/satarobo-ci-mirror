/**
 * [R5-E2E-*] P8 · Báo cáo Kết quả thi (thiết kế `QtKetQuaThi`): số liệu THẬT từ lượt đã chấm (DB) — M6 đạt lần đầu, điểm TB/tối đa, câu cần rà lại ở CẢ HAI đầu
 * (quá khó ≤30% / quá dễ 100%) kèm Dạng, câu chưa đủ lượt KHÔNG bị tính là "không có vấn đề", quyền. Ảnh `E:\tmp\r5-shots` — KHÔNG phải VISUAL_VERIFIED.
 */
import { mkdirSync } from "node:fs";
import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { login } from "../_helpers/auth";
import { seedUser } from "../_helpers/seed";
import { db } from "../../../lib/db";
import { dungVongHoc, type BoDuLieu } from "./_helpers/seed-elearning";

test.describe.configure({ mode: "serial" });

const ANH = "E:/tmp/r5-shots";
const P = "e2e-el-r5-";
const TIEN_TO_DE = "E2E_EL_R5_";
let d: BoDuLieu;
const cookie = new Map<string, Awaited<ReturnType<BrowserContext["cookies"]>>>();

async function don() {
  const de = await db.trnExam.findMany({ where: { title: { startsWith: TIEN_TO_DE } }, select: { id: true } });
  const ids = de.map((x) => x.id);
  await db.trnExamAnswer.deleteMany({ where: { attempt: { examId: { in: ids } } } });
  await db.trnExamAttempt.deleteMany({ where: { examId: { in: ids } } });
  await db.trnExamQuestion.deleteMany({ where: { examId: { in: ids } } });
  await db.trnExam.deleteMany({ where: { id: { in: ids } } });
  await db.trnQuestion.deleteMany({ where: { bankPath: { startsWith: TIEN_TO_DE } } });
  const u = await db.user.findMany({ where: { email: { startsWith: P } }, select: { id: true } });
  await db.user.deleteMany({ where: { id: { in: u.map((x) => x.id) } } });
}

test.beforeAll(async ({ browser }) => {
  d = await dungVongHoc();
  await don();
  mkdirSync(ANH, { recursive: true });
  const cs = await db.trnEnrollment.findUniqueOrThrow({ where: { id: d.enrollmentId }, select: { centerId: true, orgUnitId: true } });
  const C = { centerId: cs.centerId as string, orgUnitId: cs.orgUnitId as string };
  const q = (ten: string, type: "MULTIPLE" | "SINGLE" | "NUMERIC", stem: string) =>
    db.trnQuestion.create({ data: { bankPath: `${TIEN_TO_DE}${ten}`, type, stem, contentJson: {}, defaultPoints: 4 }, select: { id: true } });
  const qKho = await q("kho", "MULTIPLE", "Chọn mọi việc cần làm trước khi sạc pin");
  const qDe = await q("de", "SINGLE", "Nhận xét gửi phụ huynh có mấy mục?");
  const qIt = await q("it", "NUMERIC", "Câu chỉ có ba lượt trả lời");
  const de = await db.trnExam.create({ data: { title: `${TIEN_TO_DE}Kiểm tra cuối khoá — An toàn điện`, durationMin: 20, passScore: 8, maxScore: 12, isActive: true }, select: { id: true } });
  const eq: string[] = [];
  for (const [i, qq] of [qKho, qDe, qIt].entries()) {
    eq.push((await db.trnExamQuestion.create({ data: { examId: de.id, questionId: qq.id, orderIndex: i + 1, points: 4 }, select: { id: true } })).id);
  }
  const diem = [12, 10, 9, 6, 5]; // đạt (≥8): 3 trên 5 ⇒ M6 = 60%; TB = 8,4
  for (let i = 0; i < 5; i++) {
    const u = await seedUser({ email: `${P}${i + 1}@satarobo.vn`, name: `E2E R5 ${i + 1}`, role: "TEACHER" });
    const a = await db.trnExamAttempt.create({
      data: {
        examId: de.id,
        userId: u.id,
        attemptNo: 1,
        status: "GRADED",
        startedAt: new Date(Date.now() - 86_400_000),
        submittedAt: new Date(Date.now() - 86_400_000 + 600_000),
        gradedAt: new Date(),
        totalScore: diem[i]!,
        passed: diem[i]! >= 8,
        purgeAfter: new Date(Date.now() + 90 * 86_400_000),
        ...C,
      },
      select: { id: true },
    });
    // Câu khó: chỉ người đầu tiên đúng (1/5 = 20%). Câu dễ: cả 5 đúng (100%). Câu ít: chỉ 3 lượt có trả lời (dưới ngưỡng 5).
    await db.trnExamAnswer.create({ data: { attemptId: a.id, examQuestionId: eq[0]!, selectedChoiceIds: ["0"], score: i === 0 ? 4 : 0, isCorrect: i === 0 } });
    await db.trnExamAnswer.create({ data: { attemptId: a.id, examQuestionId: eq[1]!, selectedChoiceIds: ["1"], score: 4, isCorrect: true } });
    if (i < 3) await db.trnExamAnswer.create({ data: { attemptId: a.id, examQuestionId: eq[2]!, textAnswer: "3", score: 0, isCorrect: false } });
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

test("[R5-E2E-01] 🔴 'Theo đề': số liệu THẬT — Tổng lượt 5 · Lần đầu 5 · đạt lần đầu 3/5 (thanh có nhãn 60%) · điểm TB 8,4/12; nút 'Ngân hàng câu hỏi' dẫn tới kho câu hỏi; không tràn ngang", async ({ page }) => {
  await vao(page, d.daoTaoEmail, "/elearning/bao-cao-r5");
  await expect(page.getByRole("heading", { name: "Kết quả thi", exact: true })).toBeVisible();
  const dong = page.getByRole("row", { name: /An toàn điện/ });
  await expect(dong).toBeVisible();
  const o = dong.getByRole("cell");
  await expect(o.nth(1)).toHaveText("5");
  await expect(o.nth(2)).toHaveText("5");
  await expect(o.nth(3)).toContainText("3/5");
  await expect(dong.getByRole("progressbar", { name: /đạt lần đầu của .*An toàn điện: 60%/ })).toBeVisible();
  await expect(o.nth(4)).toHaveText("8,4/12");
  await chup(page, "r5-ket-qua");
  await khongTranNgang(page);
  await page.getByRole("link", { name: "Ngân hàng câu hỏi" }).click();
  await expect(page).toHaveURL(/\/elearning\/kho-cau-hoi/);
});

test("[R5-E2E-02] 🔴 câu cần rà lại ở CẢ HAI đầu kèm Dạng: 'Quá khó' (20%, Chọn nhiều) và 'Quá dễ' (100%, Chọn một); câu 3 lượt KHÔNG vào danh sách mà được NÓI là chưa đủ dữ liệu", async ({ page }) => {
  await vao(page, d.daoTaoEmail, "/elearning/bao-cao-r5");
  await expect(page.getByRole("heading", { name: /Câu hỏi cần rà lại \(2\)/ })).toBeVisible();
  const kho = page.getByRole("row", { name: /Chọn mọi việc cần làm trước khi sạc pin/ });
  await expect(kho.getByRole("cell").nth(1)).toHaveText("Chọn nhiều");
  await expect(kho.getByRole("cell").nth(3)).toHaveText("20%");
  await expect(kho.getByRole("cell").nth(4)).toContainText("Quá khó");
  const de = page.getByRole("row", { name: /Nhận xét gửi phụ huynh có mấy mục/ });
  await expect(de.getByRole("cell").nth(1)).toHaveText("Chọn một");
  await expect(de.getByRole("cell").nth(3)).toHaveText("100%");
  await expect(de.getByRole("cell").nth(4)).toContainText("Quá dễ");
  await expect(page.getByRole("row", { name: /Câu chỉ có ba lượt trả lời/ })).toHaveCount(0);
  await expect(page.getByText(/1 câu chưa đủ lượt làm để kết luận/)).toBeVisible();
});

test("[R5-E2E-03] 🔴 người học thuần bị CHẶN (không thấy số liệu của ai)", async ({ page }) => {
  await vao(page, d.hocVienEmail, "/elearning/bao-cao-r5");
  await expect(page.getByText(/elearning:progress:view-all/).first()).toBeVisible();
  await expect(page.getByRole("row", { name: /An toàn điện/ })).toHaveCount(0);
});
