/**
 * [NUM-E2E-*] Câu NHẬP SỐ trong trình duyệt thật (desktop · 375px · tối): gõ + bàn phím, báo lỗi định dạng, nộp, xem lại (đáp án/gợi ý), và
 * đáp án KHÔNG nằm trong trang lúc đang làm bài.
 */
import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { login } from "../_helpers/auth";
import { db } from "../../../lib/db";
import { dungNoiDungCauHoi } from "../../../lib/elearning/question-content-map";
import { chapNhanChinhSach, dungVongHoc, type BoDuLieu } from "./_helpers/seed-elearning";

test.describe.configure({ mode: "serial" });

const MA = "E2E_EL_CAUSO";
const GOI_Y = "Nhân với 4 phần trăm";
let d: BoDuLieu;
let cookie: Awaited<ReturnType<BrowserContext["cookies"]>>;
let ids: { enrollmentId: string; lessonId: string; examId: string; courseId: string };

async function don() {
  const khoa = await db.trnCourse.findUnique({ where: { code: MA }, select: { id: true } });
  if (khoa) {
    await db.trnLessonProgress.deleteMany({ where: { lesson: { module: { courseId: khoa.id } } } });
    await db.trnCertificate.deleteMany({ where: { courseId: khoa.id } });
    await db.trnReminder.deleteMany({ where: { enrollment: { courseId: khoa.id } } });
  }
  await db.trnExamAnswer.deleteMany({ where: { attempt: { exam: { title: `${MA} đề` } } } });
  await db.trnExamAttempt.deleteMany({ where: { exam: { title: `${MA} đề` } } });
  if (khoa) {
    await db.trnEnrollment.deleteMany({ where: { courseId: khoa.id } });
    await db.trnCourseVersionLesson.deleteMany({ where: { version: { courseId: khoa.id } } });
    await db.trnCourseVersion.deleteMany({ where: { courseId: khoa.id } });
    await db.trnLesson.deleteMany({ where: { module: { courseId: khoa.id } } });
    await db.trnModule.deleteMany({ where: { courseId: khoa.id } });
    await db.trnCourse.delete({ where: { id: khoa.id } });
  }
  await db.trnExamQuestion.deleteMany({ where: { exam: { title: `${MA} đề` } } });
  await db.trnExam.deleteMany({ where: { title: `${MA} đề` } });
  await db.trnQuestion.deleteMany({ where: { bankPath: `${MA}-kho` } });
}

test.beforeAll(async ({ browser }) => {
  d = await dungVongHoc();
  await don();
  await chapNhanChinhSach(d.hocVienId);
  const chinh = await db.trnEnrollment.findUniqueOrThrow({ where: { id: d.enrollmentId }, select: { centerId: true, orgUnitId: true } });
  const khoa = await db.trnCourse.create({
    data: { code: MA, slug: MA.toLowerCase(), title: `${MA} khoá`, status: "PUBLISHED", visibility: "ASSIGNED_ONLY", selfEnrollEnabled: false, sequential: false, securityLevel: "INTERNAL" },
    select: { id: true },
  });
  const chuong = await db.trnModule.create({ data: { courseId: khoa.id, title: "Chương số", orderIndex: 0 }, select: { id: true } });
  const q = await db.trnQuestion.create({ data: { bankPath: `${MA}-kho`, type: "NUMERIC", stem: "Học viên đóng 3.000.000đ. Hoa hồng 4% là bao nhiêu đồng?", contentJson: {}, defaultPoints: 1, explanation: "4% của 3.000.000đ" }, select: { id: true } });
  await db.trnQuestion.update({
    where: { id: q.id },
    data: { contentJson: dungNoiDungCauHoi({ questionId: q.id, type: "NUMERIC", stem: "Học viên đóng 3.000.000đ. Hoa hồng 4% là bao nhiêu đồng?", so: { answer: 120000, tolerance: 0, unit: "đ", hint: GOI_Y } }) as object },
  });
  const de = await db.trnExam.create({ data: { title: `${MA} đề`, durationMin: 30, passScore: 1, maxScore: 1, maxAttempts: 3, cooldownHours: 0, isActive: true, showAnswerPolicy: "AFTER_EACH_ATTEMPT" }, select: { id: true } });
  await db.trnExamQuestion.create({ data: { examId: de.id, questionId: q.id, orderIndex: 0, points: 1 } });
  const bai = await db.trnLesson.create({ data: { moduleId: chuong.id, title: `${MA} bài thi`, kind: "QUIZ", orderIndex: 0, examId: de.id }, select: { id: true } });
  const pb = await db.trnCourseVersion.create({ data: { courseId: khoa.id, major: 1, minor: 0, status: "PUBLISHED" }, select: { id: true } });
  await db.trnCourseVersionLesson.create({ data: { versionId: pb.id, lessonId: bai.id, required: false, orderIndex: 0, contentHash: "e2e-hash-cau-so" } });
  const han = new Date(Date.now() + 30 * 86_400_000);
  const gd = await db.trnEnrollment.create({
    data: { courseId: khoa.id, courseVersionId: pb.id, userId: d.hocVienId, cycle: 1, status: "NOT_STARTED", dueAt: han, dueAtOriginal: han, source: "ASSIGNMENT", snapJobTitle: "NV", centerId: chinh.centerId, orgUnitId: chinh.orgUnitId },
    select: { id: true },
  });
  ids = { enrollmentId: gd.id, lessonId: bai.id, examId: de.id, courseId: khoa.id };
  const ctx = await browser.newContext();
  const p = await ctx.newPage();
  await login(p, { email: d.hocVienEmail, callbackUrl: "/elearning" });
  cookie = await ctx.cookies();
  await ctx.close();
});

test.afterAll(async () => {
  await don();
});

async function vao(page: Page, duongDan: string) {
  // Rời trang cũ TRƯỚC khi đổi cookie: yêu cầu nền của trang cũ (làm mới phiên) về muộn sẽ ghi đè cookie mới (D-51).
  await page.goto("about:blank");
  await page.context().clearCookies();
  await page.context().addCookies(cookie);
  await page.goto(duongDan);
  await expect(page.locator("[data-elearning-theme]")).toBeVisible();
}

test("[NUM-E2E-01] làm bài: bàn phím + gõ, báo lỗi định dạng, đáp án KHÔNG có trong trang, nộp rồi xem lại có đáp án + gợi ý (sai)", async ({ page }) => {
  await vao(page, `/elearning/hoc/${ids.enrollmentId}/${ids.lessonId}`);
  await page.getByRole("button", { name: "Bắt đầu làm bài" }).click();
  const o = page.getByLabel("Trả lời câu 1");
  await expect(o).toBeVisible();
  await expect(page.getByText("đ", { exact: true }).first()).toBeVisible(); // đơn vị

  // Đáp án/sai số/gợi ý không có ở ĐÂU trong trang thi (kể cả mã nguồn trang).
  const html = await page.content();
  for (const bi of ["120000", GOI_Y]) expect(html, bi).not.toContain(bi);

  // Bàn phím: 1 2 0 ⌫ → "12"
  for (const k of ["1", "2", "0"]) await page.getByRole("group", { name: "Bàn phím số" }).getByRole("button", { name: k, exact: true }).click();
  await page.getByRole("button", { name: "Xoá ký tự cuối" }).click();
  await expect(o).toHaveValue("12");

  // Lỗi định dạng hiện ngay
  await o.fill("1.000,5");
  await expect(page.getByText(/Chỉ dùng MỘT dấu/)).toBeVisible();

  // Trả lời SAI hợp lệ rồi nộp ngay (không rời ô trước: nộp phải chốt lưu câu dở).
  await o.fill("119999");
  await expect(page.getByText(/Chỉ dùng MỘT dấu/)).toHaveCount(0);
  await page.getByRole("button", { name: "Nộp bài" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Nộp bài" }).click();
  await expect(page.getByRole("button", { name: "Bắt đầu làm bài" }).or(page.getByText(/Đã nộp/)).first()).toBeVisible({ timeout: 20_000 });

  // Chốt: server chấm theo bản đã lưu → SAI
  const gan = await db.trnExamAnswer.findFirst({ where: { attempt: { examId: ids.examId } }, select: { textAnswer: true, isCorrect: true, score: true } });
  expect(gan).toMatchObject({ textAnswer: "119999", isCorrect: false, score: 0 });

  await vao(page, `/elearning/hoc/${ids.enrollmentId}/${ids.lessonId}/ket-qua`);
  // Theo vai trò (không phải getByText trần): React streaming để lại bản sao trong `DIV#S:0[hidden]` đến lúc hoán đổi xong;
  // locator theo vai trò bỏ qua phần tử ẩn nên chỉ trúng bản người dùng thấy.
  const cacCau = page.getByRole("list", { name: "Các câu của bài" });
  await expect(cacCau.getByText("Đáp án đúng:")).toBeVisible();
  await expect(cacCau.getByText("120000 đ")).toBeVisible();
  await expect(cacCau.getByText(GOI_Y)).toBeVisible();
});

test("[NUM-E2E-02] làm lại: gõ ĐÚNG bằng dấu phẩy hoặc chấm ⇒ đúng, và KHÔNG có gợi ý ở câu đúng", async ({ page }) => {
  await vao(page, `/elearning/hoc/${ids.enrollmentId}/${ids.lessonId}`);
  await page.getByRole("button", { name: "Bắt đầu làm bài" }).click();
  const o = page.getByLabel("Trả lời câu 1");
  await o.fill("120000,0");
  await page.getByRole("button", { name: "Nộp bài" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Nộp bài" }).click();
  await expect.poll(async () => (await db.trnExamAnswer.findMany({ where: { attempt: { examId: ids.examId, attemptNo: 2 } }, select: { isCorrect: true } }))[0]?.isCorrect, { timeout: 20_000 }).toBe(true);
  await vao(page, `/elearning/hoc/${ids.enrollmentId}/${ids.lessonId}/ket-qua`);
  // Đối chứng dương trước khi khẳng định "vắng": trang đã vẽ xong và câu này ĐÚNG; rồi mới đo gợi ý không có.
  const cacCau = page.getByRole("list", { name: "Các câu của bài" });
  await expect(cacCau.getByText("Đúng", { exact: true })).toBeVisible();
  await expect(cacCau.getByText(GOI_Y)).toHaveCount(0);
});

test("[NUM-E2E-03] không tràn ngang khi làm bài", async ({ page }) => {
  await vao(page, `/elearning/hoc/${ids.enrollmentId}/${ids.lessonId}`);
  await page.getByRole("button", { name: "Bắt đầu làm bài" }).click();
  await expect(page.getByLabel("Trả lời câu 1")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
});
