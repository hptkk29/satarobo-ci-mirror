/**
 * [CT-E2E-*] P8 · Chấm bài thi tự luận master-detail (thiết kế `QtChamThi`): hàng chờ trái / khung chấm phải, chuyển lượt, tìm kiếm, CHỐT ĐIỂM THẬT (DB),
 * không tự chấm bài của mình, quyền, tab Online nói thẳng là chưa có hàng chờ (không đọc Trn*). Ảnh ở `E:\tmp\ct-shots` — KHÔNG phải VISUAL_VERIFIED.
 */
import { mkdirSync } from "node:fs";
import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { login } from "../_helpers/auth";
import { db } from "../../../lib/db";
import { dungVongHoc, type BoDuLieu } from "./_helpers/seed-elearning";

test.describe.configure({ mode: "serial" });

const ANH = "E:/tmp/ct-shots";
const P = "E2E_EL_CT_";
let d: BoDuLieu;
let idHocVien = ""; // lượt của người học e2e (chờ 3 ngày)
let idDaoTao = ""; // lượt của CHÍNH người chấm (chờ 1 ngày) — không được tự chấm
let examId = "";
const cookie = new Map<string, Awaited<ReturnType<BrowserContext["cookies"]>>>();

async function don() {
  const de = await db.trnExam.findMany({ where: { title: { startsWith: P } }, select: { id: true } });
  const ids = de.map((x) => x.id);
  await db.trnExamAnswer.deleteMany({ where: { attempt: { examId: { in: ids } } } });
  await db.trnExamAttempt.deleteMany({ where: { examId: { in: ids } } });
  await db.trnExamQuestion.deleteMany({ where: { examId: { in: ids } } });
  await db.trnExam.deleteMany({ where: { id: { in: ids } } });
  await db.trnQuestion.deleteMany({ where: { bankPath: { startsWith: P } } });
}

test.beforeAll(async ({ browser }) => {
  d = await dungVongHoc();
  await don();
  mkdirSync(ANH, { recursive: true });
  const cs = await db.trnEnrollment.findUniqueOrThrow({ where: { id: d.enrollmentId }, select: { centerId: true, orgUnitId: true } });
  const C = { centerId: cs.centerId as string, orgUnitId: cs.orgUnitId as string };
  const q = (ten: string, type: "SINGLE" | "ESSAY", stem: string, pts: number) =>
    db.trnQuestion.create({ data: { bankPath: `${P}${ten}`, type, stem, contentJson: {}, defaultPoints: pts }, select: { id: true } });
  const q1 = await q("may1", "SINGLE", "Chọn thiết bị bảo hộ đúng", 1);
  const q2 = await q("may2", "SINGLE", "Chọn thứ tự ngắt điện", 1);
  const q3 = await q("tl1", "ESSAY", "Mô tả cách xử lý khi lớp có mùi khét từ robot.", 2);
  const q4 = await q("tl2", "ESSAY", "Vì sao không để pin sạc qua đêm ở lớp?", 3);
  const de = await db.trnExam.create({ data: { title: `${P}Kiểm tra cuối khoá — An toàn điện`, durationMin: 20, passScore: 5, maxScore: 7, isActive: true }, select: { id: true } });
  examId = de.id;
  const eq: string[] = [];
  for (const [i, [qq, pts]] of ([[q1, 1], [q2, 1], [q3, 2], [q4, 3]] as const).entries()) {
    const r = await db.trnExamQuestion.create({ data: { examId: de.id, questionId: qq.id, orderIndex: i + 1, points: pts }, select: { id: true } });
    eq.push(r.id);
  }
  const luot = async (userId: string, ngayTruoc: number) => {
    const a = await db.trnExamAttempt.create({
      data: {
        examId: de.id,
        userId,
        attemptNo: 1,
        status: "PENDING_GRADE",
        startedAt: new Date(Date.now() - ngayTruoc * 86_400_000 - 600_000),
        submittedAt: new Date(Date.now() - ngayTruoc * 86_400_000),
        purgeAfter: new Date(Date.now() + 90 * 86_400_000),
        ...C,
      },
      select: { id: true },
    });
    // Hai câu máy đã chấm (đúng, 1 điểm mỗi câu) + hai câu tự luận có bài làm, CHƯA có điểm.
    await db.trnExamAnswer.create({ data: { attemptId: a.id, examQuestionId: eq[0]!, selectedChoiceIds: ["1"], score: 1 } });
    await db.trnExamAnswer.create({ data: { attemptId: a.id, examQuestionId: eq[1]!, selectedChoiceIds: ["0"], score: 1 } });
    await db.trnExamAnswer.create({ data: { attemptId: a.id, examQuestionId: eq[2]!, textAnswer: "Em cho các con dừng tay, rút pin, mở cửa sổ và báo quản lý cơ sở." } });
    await db.trnExamAnswer.create({ data: { attemptId: a.id, examQuestionId: eq[3]!, textAnswer: "Vì không có người trông, pin nóng thì không ai phát hiện kịp." } });
    return a.id;
  };
  idHocVien = await luot(d.hocVienId, 3);
  idDaoTao = await luot(d.daoTaoId, 1);
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
const danhSach = (page: Page) => page.getByRole("region", { name: "Bài thi đang chờ chấm" });
const khung = (page: Page) => page.getByRole("region", { name: "Khung chấm bài thi" });

test("[CT-E2E-01] 🔴 master-detail: hàng chờ bên trái (người chờ lâu nhất trước, nhãn 'chờ N ngày'), lượt đầu được chọn, bên phải có phần máy chấm + câu tự luận; không tràn ngang", async ({ page }) => {
  await vao(page, d.daoTaoEmail, "/elearning/cham-bai");
  await expect(page.getByRole("heading", { name: "Chấm bài thi tự luận", exact: true })).toBeVisible();
  const dong = danhSach(page).getByRole("link");
  await expect(dong).toHaveCount(2);
  await expect(dong.first()).toHaveAttribute("aria-current", "true");
  await expect(dong.first()).toContainText("chờ 3 ngày"); // người chờ lâu nhất xếp trước
  await expect(dong.nth(1)).toContainText("chờ 1 ngày");
  await expect(dong.first()).toContainText("lượt 1");
  await expect(khung(page).getByRole("heading", { name: /An toàn điện/ })).toBeVisible();
  await expect(khung(page).getByText("Phần máy chấm: 2/2 câu đúng — 2 điểm. Còn 2 câu cần chấm tay.")).toBeVisible();
  await expect(khung(page).getByText("Vì sao không để pin sạc qua đêm ở lớp?")).toBeVisible();
  await expect(khung(page).getByText("Em cho các con dừng tay")).toBeVisible(); // bài làm của người học
  await expect(khung(page).getByRole("button", { name: "Chốt điểm" })).toBeDisabled(); // còn ô trống
  await chup(page, "ct-master-detail");
  await khongTranNgang(page);
});

test("[CT-E2E-02] 🔴 chuyển lượt: bấm lượt của CHÍNH người chấm ⇒ ?id=, KHÔNG vẽ form chấm, nói 'không tự chấm được' (đối chứng dương: lượt kia có nút Chốt điểm)", async ({ page }) => {
  await vao(page, d.daoTaoEmail, `/elearning/cham-bai?id=${idHocVien}`);
  await expect(khung(page).getByRole("button", { name: "Chốt điểm" })).toBeVisible();
  await danhSach(page).getByRole("link").nth(1).click();
  await expect(page).toHaveURL(new RegExp(`id=${idDaoTao}`));
  await expect(khung(page).getByText(/không tự chấm được/)).toBeVisible();
  await expect(khung(page).getByRole("button", { name: "Chốt điểm" })).toHaveCount(0);
  await expect(khung(page).getByRole("spinbutton")).toHaveCount(0);
});

test("[CT-E2E-03] tìm không dấu theo tên người học / đề; không khớp ⇒ nói đúng điều đó (không phải 'không có bài chờ')", async ({ page }) => {
  await vao(page, d.daoTaoEmail, "/elearning/cham-bai?q=an+toan+dien");
  await expect(danhSach(page).getByRole("link")).toHaveCount(2);
  await vao(page, d.daoTaoEmail, "/elearning/cham-bai?q=khong-co-ai-ten-nay");
  await expect(page.getByText("Không có bài nào khớp")).toBeVisible();
  await expect(page.getByText("Không có bài nào đang chờ chấm")).toHaveCount(0);
});

test("[CT-E2E-04] 🔴 tab 'Học viên online': nói thẳng chưa có hàng chờ chấm tay, KHÔNG đọc Trn* thay thế (không có danh sách/khung chấm)", async ({ page }) => {
  await vao(page, d.daoTaoEmail, "/elearning/cham-bai?tab=hoc-vien-online");
  await expect(page.getByText("Khoá online chưa có bài thi chấm tay")).toBeVisible();
  await expect(danhSach(page)).toHaveCount(0);
  await expect(khung(page)).toHaveCount(0);
  await expect(page.getByText("Học Viên E2E")).toHaveCount(0);
});

test("[CT-E2E-05] 🔴 người học thuần bị CHẶN (không thấy hàng chờ, không có khung chấm)", async ({ page }) => {
  await vao(page, d.hocVienEmail, "/elearning/cham-bai");
  await expect(page.getByText(/elearning:exam:grade/).first()).toBeVisible();
  await expect(danhSach(page)).toHaveCount(0);
  await expect(khung(page)).toHaveCount(0);
});

test("[CT-E2E-06] 🔴 CHỐT ĐIỂM THẬT: nhập điểm hai câu tự luận ⇒ DB đổi sang GRADED với tổng 7 (2 máy + 2 + 3), đạt; sau đó tự sang lượt kế tiếp", async ({ page }) => {
  await vao(page, d.daoTaoEmail, `/elearning/cham-bai?id=${idHocVien}`);
  const diem2 = khung(page).getByLabel("Điểm (0–2)");
  const diem3 = khung(page).getByLabel("Điểm (0–3)");
  await diem2.fill("5"); // vượt thang ⇒ chặn
  await expect(khung(page).getByText(/vượt thang/)).toBeVisible();
  await expect(khung(page).getByRole("button", { name: "Chốt điểm" })).toBeDisabled();
  await diem2.fill("2");
  await diem3.fill("3");
  await expect(khung(page).getByText(/Tổng tạm tính: 7\/7 — đạt từ 5/)).toBeVisible();
  await khung(page).getByRole("button", { name: "Chốt điểm" }).click();
  await expect.poll(async () => (await db.trnExamAttempt.findUniqueOrThrow({ where: { id: idHocVien }, select: { status: true } })).status, { timeout: 30_000 }).toBe("GRADED");
  const a = await db.trnExamAttempt.findUniqueOrThrow({ where: { id: idHocVien }, select: { totalScore: true, passed: true, gradedByUserId: true } });
  expect(a.totalScore).toBe(7);
  expect(a.passed).toBe(true);
  expect(a.gradedByUserId).toBe(d.daoTaoId);
  await expect(page).toHaveURL(new RegExp(`id=${idDaoTao}`), { timeout: 20_000 }); // sang lượt kế tiếp
  await expect(danhSach(page).getByRole("link")).toHaveCount(1); // lượt đã chấm rời hàng chờ
  await chup(page, "ct-sau-chot");
  expect(examId).not.toBe("");
});
