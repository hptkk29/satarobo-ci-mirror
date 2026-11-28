/**
 * [B11-E2E-*] B-11 trong TRÌNH SOẠN, trình duyệt thật (Đào tạo đăng nhập): bài nằm trong bản đã xuất bản ⇒ (1) có dòng báo "Lưu sẽ tạo bản nháp mới";
 * (2) bấm Lưu ⇒ bài GỐC KHÔNG ĐỔI, trang chuyển sang bài của bản nháp, và ở đó dòng báo biến mất; (3) cùng điều đó với trình soạn ĐỀ (đường `router.refresh()`
 * → chuyển trang phía máy chủ), không chỉ với bài đọc. Ca "không có dòng báo" luôn kèm đối chứng dương.
 */
import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { login } from "../_helpers/auth";
import { db } from "../../../lib/db";
import { bamNoiDungBai } from "../../../lib/elearning/ban-noi-dung";
import { dungVongHoc, type BoDuLieu } from "./_helpers/seed-elearning";

test.describe.configure({ mode: "serial" });

const MA = "E2E_EL_B11SOAN";
const DE_A = `${MA} đề A`;
const DE_B = `${MA} đề B`;
let d: BoDuLieu;
let cookie: Awaited<ReturnType<BrowserContext["cookies"]>>;
let ids: { courseId: string; baiVideo: string; baiDoc: string; baiThi: string; baiMoi: string; deAId: string; deBId: string; banPhatHanh: string };

async function don() {
  const khoa = await db.trnCourse.findUnique({ where: { code: MA }, select: { id: true } });
  if (khoa) {
    await db.trnCourseVersionLesson.deleteMany({ where: { version: { courseId: khoa.id } } });
    await db.trnCourseVersion.deleteMany({ where: { courseId: khoa.id } });
    await db.trnLesson.deleteMany({ where: { module: { courseId: khoa.id } } });
    await db.trnModule.deleteMany({ where: { courseId: khoa.id } });
    await db.trnCourse.delete({ where: { id: khoa.id } });
  }
  await db.trnExamQuestion.deleteMany({ where: { exam: { title: { in: [DE_A, DE_B] } } } });
  await db.trnExam.deleteMany({ where: { title: { in: [DE_A, DE_B] } } });
}

test.beforeAll(async ({ browser }) => {
  d = await dungVongHoc();
  await don();
  const khoa = await db.trnCourse.create({
    data: { code: MA, slug: MA.toLowerCase(), title: `${MA} khoá`, status: "PUBLISHED", visibility: "ASSIGNED_ONLY", selfEnrollEnabled: false, sequential: false, securityLevel: "INTERNAL" },
    select: { id: true },
  });
  const ch = await db.trnModule.create({ data: { courseId: khoa.id, title: "Chương B11", orderIndex: 0 }, select: { id: true } });
  const mkDe = (title: string) => db.trnExam.create({ data: { title, durationMin: 10, passScore: 1, maxScore: 1, maxAttempts: 3, cooldownHours: 0, isActive: true }, select: { id: true } });
  const deA = await mkDe(DE_A);
  const deB = await mkDe(DE_B);
  const baiDoc = await db.trnLesson.create({ data: { moduleId: ch.id, title: "B11 bài đọc", kind: "READ", orderIndex: 1, contentMd: "bản đang phát hành", minReadSeconds: 10 }, select: { id: true } });
  const baiThi = await db.trnLesson.create({ data: { moduleId: ch.id, title: "B11 bài thi", kind: "QUIZ", orderIndex: 2, examId: deA.id }, select: { id: true } });
  const pb = await db.trnCourseVersion.create({ data: { courseId: khoa.id, major: 1, minor: 0, status: "PUBLISHED", publishedAt: new Date("2026-11-01T03:00:00.000Z") }, select: { id: true } });
  for (const [l, i] of [[baiDoc.id, 1], [baiThi.id, 2]] as const) {
    const row = await db.trnLesson.findUniqueOrThrow({ where: { id: l } });
    await db.trnCourseVersionLesson.create({ data: { versionId: pb.id, lessonId: l, orderIndex: i, required: false, contentHash: bamNoiDungBai(row) } });
  }
  const baiVideo = await db.trnLesson.create({ data: { moduleId: ch.id, title: "B11 video gốc", kind: "VIDEO", orderIndex: 4, durationSec: 600, videoKey: `elearning/master/${MA}/v.mp4` }, select: { id: true } });
  await db.trnCourseVersionLesson.create({
    data: { versionId: pb.id, lessonId: baiVideo.id, orderIndex: 3, required: false, contentHash: bamNoiDungBai(await db.trnLesson.findUniqueOrThrow({ where: { id: baiVideo.id } })) },
  });
  // Đối chứng: một bài CHƯA nằm trong bản đã khoá nào (mới thêm, chưa gửi duyệt) — mở trình soạn của nó KHÔNG được có dòng báo.
  const baiMoi = await db.trnLesson.create({ data: { moduleId: ch.id, title: "B11 bài mới chưa vào bản nào", kind: "READ", orderIndex: 3, contentMd: "nháp", minReadSeconds: 10 }, select: { id: true } });
  ids = { courseId: khoa.id, baiVideo: baiVideo.id, baiDoc: baiDoc.id, baiThi: baiThi.id, baiMoi: baiMoi.id, deAId: deA.id, deBId: deB.id, banPhatHanh: pb.id };

  const ctx = await browser.newContext();
  const p = await ctx.newPage();
  await login(p, { email: d.daoTaoEmail, callbackUrl: "/elearning" });
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

const DONG_BAO = "Lưu sẽ tạo bản nháp mới";

test("[B11-E2E-00] không tràn ngang ở trình soạn khi CÓ dòng báo (chạy trước ca tách bản — sau đó bài chuyển sang bản nháp)", async ({ page }) => {
  await vao(page, `/elearning/soan/${ids.baiDoc}`);
  await expect(page.getByText(DONG_BAO)).toBeVisible();
  await expect(page.getByLabel("Nội dung bài, định dạng Markdown")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
});

test("[B11-E2E-01] bài ĐỌC trong bản đã xuất bản: có dòng báo; Lưu ⇒ bài gốc nguyên văn, trang chuyển sang bài của bản nháp, ở đó KHÔNG còn dòng báo", async ({ page }) => {
  await vao(page, `/elearning/soan/${ids.baiDoc}`);
  await expect(page.getByText(DONG_BAO)).toBeVisible();

  // Chờ HYDRATION thật: ô xem trước vẽ từ state React; `fill` trước hydration ghi vào DOM mà state vẫn giữ giá trị cũ (đã gặp: nội dung bị nối "mới+cũ").
  const oSoan = page.getByLabel("Nội dung bài, định dạng Markdown");
  await expect(async () => {
    await oSoan.fill("bản đã sửa của bản nháp");
    // GIÁ TRỊ CHÍNH XÁC (không phải chuỗi con): fill giữa lúc hydration chèn chữ mới vào ĐẦU chữ cũ ("mới+cũ").
    await expect(oSoan).toHaveValue("bản đã sửa của bản nháp", { timeout: 1_000 });
    await expect(page.getByRole("article")).toHaveText("bản đã sửa của bản nháp", { timeout: 1_000 });
  }).toPass({ timeout: 15_000 });
  await page.getByRole("button", { name: "Lưu bài" }).click();
  // Chuyển sang bài KHÁC (bản tách của bản nháp) — id trên URL đổi.
  await expect(page).not.toHaveURL(new RegExp(`/elearning/soan/${ids.baiDoc}$`), { timeout: 20_000 });
  await expect(page).toHaveURL(/\/elearning\/soan\/[^/]+$/);
  // Bài gốc (người học đang đọc) KHÔNG đổi; có đúng một bản nháp mới chứa bài đã sửa.
  const goc = await db.trnLesson.findUniqueOrThrow({ where: { id: ids.baiDoc }, select: { contentMd: true } });
  expect(goc.contentMd).toBe("bản đang phát hành");
  const nhap = await db.trnCourseVersion.findMany({ where: { courseId: ids.courseId, status: "DRAFT" }, select: { id: true, lessons: { select: { lesson: { select: { id: true, contentMd: true } } } } } });
  expect(nhap).toHaveLength(1);
  expect(nhap[0].lessons.map((v) => v.lesson.contentMd)).toContain("bản đã sửa của bản nháp");
  // Ở bài của bản nháp: dòng báo biến mất (đối chứng âm của ca đầu) và nội dung mới hiện trong ô soạn.
  await expect(page.getByLabel("Nội dung bài, định dạng Markdown")).toHaveValue("bản đã sửa của bản nháp");
  await expect(page.getByText(DONG_BAO)).toHaveCount(0);
});

test("[B11-E2E-02] đối chứng: bài CHƯA nằm trong bản đã khoá nào ⇒ KHÔNG có dòng báo (trang vẫn dựng được: có ô soạn)", async ({ page }) => {
  await vao(page, `/elearning/soan/${ids.baiMoi}`);
  await expect(page.getByLabel("Nội dung bài, định dạng Markdown")).toBeVisible();
  await expect(page.getByText(DONG_BAO)).toHaveCount(0);
});

test("[B11-E2E-03] bài KIỂM TRA trong bản đã xuất bản: có dòng báo; gắn đề khác ⇒ bài gốc vẫn đề cũ, trang tự chuyển sang bài của bản nháp (đường refresh → chuyển trang phía máy chủ)", async ({ page }) => {
  await vao(page, `/elearning/soan/${ids.baiThi}`);
  await expect(page.getByText(DONG_BAO)).toBeVisible();
  // Lối sang màn dựng đề: mở TAB MỚI, đích là route thật.
  const moDe = page.getByRole("link", { name: /Mở Đề thi/ });
  await expect(moDe).toHaveAttribute("href", "/elearning/de-thi");
  await expect(moDe).toHaveAttribute("target", "_blank");
  await page.getByLabel("Đề thi gắn vào bài").selectOption(ids.deBId);
  await page.getByRole("button", { name: "Lưu", exact: true }).click();
  await expect(page).not.toHaveURL(new RegExp(`/elearning/soan/${ids.baiThi}$`), { timeout: 20_000 });
  const goc = await db.trnLesson.findUniqueOrThrow({ where: { id: ids.baiThi }, select: { examId: true } });
  expect(goc.examId).toBe(ids.deAId);
  const url = new URL(page.url());
  const idMoi = url.pathname.split("/").pop()!;
  const moi = await db.trnLesson.findUniqueOrThrow({ where: { id: idMoi }, select: { examId: true } });
  expect(moi.examId).toBe(ids.deBId);
  await expect(page.getByLabel("Đề thi gắn vào bài")).toHaveValue(ids.deBId);
  await expect(page.getByText(DONG_BAO)).toHaveCount(0);
});

test("[B11-E2E-04] báo cáo xem video: bài gốc và BẢN TÁCH hiện thành hai nút phân biệt được (nhãn 'bài gốc' / 'bản tách (bản nháp)'), bản tách ngay dưới bài gốc; bài không tách giữ tên trơn", async ({ page }) => {
  // Bản tách của bài video nằm trong bản NHÁP (đã có từ ca 01).
  const nhap = await db.trnCourseVersion.findFirstOrThrow({ where: { courseId: ids.courseId, status: "DRAFT" }, select: { id: true } });
  const goc = await db.trnLesson.findUniqueOrThrow({ where: { id: ids.baiVideo } });
  const tach = await db.trnLesson.create({
    data: { moduleId: goc.moduleId, title: goc.title, kind: "VIDEO", orderIndex: 90, durationSec: goc.durationSec, videoKey: goc.videoKey, forkedFromLessonId: goc.id },
    select: { id: true },
  });
  await db.trnCourseVersionLesson.create({ data: { versionId: nhap.id, lessonId: tach.id, orderIndex: 90, required: false, contentHash: "e2e-b11-tach" } });

  await vao(page, "/elearning/bao-cao/video");
  const dieuHuong = page.getByRole("navigation", { name: "Bài video" });
  const nutGoc = dieuHuong.getByRole("link", { name: "B11 video gốc — bài gốc" });
  const nutTach = dieuHuong.getByRole("link", { name: "B11 video gốc — bản tách (bản nháp)" });
  await expect(nutGoc).toBeVisible();
  await expect(nutTach).toBeVisible();
  // Bản tách đứng liền sau bài gốc.
  const nhan = await dieuHuong.getByRole("link").allInnerTexts();
  const i = nhan.indexOf("B11 video gốc — bài gốc");
  expect(nhan[i + 1]).toBe("B11 video gốc — bản tách (bản nháp)");
  // Mỗi nút trỏ tới ĐÚNG id bài của nó (không gộp hai bài làm một).
  await expect(nutGoc).toHaveAttribute("href", `/elearning/bao-cao/video?bai=${ids.baiVideo}`);
  await expect(nutTach).toHaveAttribute("href", `/elearning/bao-cao/video?bai=${tach.id}`);
});
