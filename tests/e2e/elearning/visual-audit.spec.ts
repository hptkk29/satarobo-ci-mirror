/**
 * [VISUAL-AUDIT] Chụp màn React ở đúng viewport/chủ đề để ĐỐI CHỨNG với bộ HTML thiết kế (`E:\websatarobo data\elearning-html`).
 *
 * KHÔNG khẳng định gì — là CÔNG CỤ. Chỉ chạy khi `VISUAL_AUDIT_DIR` được đặt (đường dẫn thư mục xuất ảnh); không đặt ⇒ bỏ qua toàn bộ,
 * nên không ảnh hưởng cổng e2e. Ảnh tham chiếu sinh bằng `implementation/tools/chup-tham-chieu.mjs` (cùng viewport, đợi font + mạng rảnh).
 *
 * Dùng dữ liệu seed của e2e (Học viên/Đào tạo giả) — nội dung khác dữ liệu mẫu của HTML, nên so BỐ CỤC/TYPOGRAPHY/SPACING, không so chữ.
 */
import { test, type BrowserContext, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { login } from "../_helpers/auth";
import { db } from "../../../lib/db";
import { donKhoaDuyet, donLuotGiaoDaDong, dungKhoaDuyet, dungLuotGiaoDaDong, dungVongHoc, type BoDuLieu, type BoKhoaDuyet } from "./_helpers/seed-elearning";

const DIR = process.env.VISUAL_AUDIT_DIR ?? "";
test.skip(!DIR, "đặt VISUAL_AUDIT_DIR để chụp ảnh đối chứng");
test.describe.configure({ mode: "serial" });

let d: BoDuLieu;
let k: BoKhoaDuyet;
let soan: { doc: string; video: string; quiz: string; task: string; live: string } | null = null;
const MA_SOAN = "E2E_EL_VASOAN";
const cookie = new Map<string, Awaited<ReturnType<BrowserContext["cookies"]>>>();

async function donSoan() {
  const khoa = await db.trnCourse.findUnique({ where: { code: MA_SOAN }, select: { id: true } });
  if (khoa) {
    await db.trnCourseVersionLesson.deleteMany({ where: { version: { courseId: khoa.id } } });
    await db.trnCourseVersion.deleteMany({ where: { courseId: khoa.id } });
    await db.trnLesson.deleteMany({ where: { module: { courseId: khoa.id } } });
    await db.trnModule.deleteMany({ where: { courseId: khoa.id } });
    await db.trnCourse.delete({ where: { id: khoa.id } });
  }
  await db.trnExam.deleteMany({ where: { title: `${MA_SOAN} đề` } });
}

async function dungSoan() {
  await donSoan();
  const khoa = await db.trnCourse.create({
    data: { code: MA_SOAN, slug: MA_SOAN.toLowerCase(), title: "Bộ Beta — cảm biến cơ bản", status: "DRAFT", visibility: "ASSIGNED_ONLY", selfEnrollEnabled: false, sequential: false, securityLevel: "INTERNAL" },
    select: { id: true },
  });
  const ch = await db.trnModule.create({ data: { courseId: khoa.id, title: "Làm quen cảm biến", orderIndex: 0 }, select: { id: true } });
  const de = await db.trnExam.create({ data: { title: `${MA_SOAN} đề`, durationMin: 10, passScore: 1, maxScore: 1, maxAttempts: 3, isActive: true }, select: { id: true } });
  const bai = (i: number, title: string, data: Record<string, unknown>) =>
    db.trnLesson.create({ data: { moduleId: ch.id, title, orderIndex: i, ...data } as never, select: { id: true } }).then((x) => x.id);
  const doc = await bai(0, "Cảm biến là gì?", { kind: "READ", minReadSeconds: 180, contentMd: "## Cảm biến là gì?\n\nCảm biến giúp robot **nhận biết** thế giới xung quanh.\n\n- Siêu âm: đo khoảng cách\n- Ánh sáng: phân biệt màu\n\n> Mẹo: cho con thử che cảm biến bằng tay." });
  const video = await bai(1, "Lắp cảm biến siêu âm lên Beta", { kind: "VIDEO", youtubeId: "k9PqAbCdEfG", youtubePhuDe: true, durationSec: 664 });
  const quiz = await bai(2, "Kiểm tra chương 2", { kind: "QUIZ" });
  const task = await bai(3, "Ảnh lắp ráp hoàn chỉnh", { kind: "TASK" });
  const live = await bai(4, "Thực hành tại cơ sở", { kind: "LIVE_SESSION" });
  void de;
  return { doc, video, quiz, task, live };
}

test.beforeAll(async ({ browser }) => {
  if (!DIR) return;
  mkdirSync(DIR, { recursive: true });
  d = await dungVongHoc();
  k = await dungKhoaDuyet(d);
  soan = await dungSoan(); // SAU dungVongHoc: nó dọn mọi dữ liệu mang tiền tố E2E_EL_
  await dungLuotGiaoDaDong(d);
  for (const email of [d.hocVienEmail, d.daoTaoEmail]) {
    const ctx = await browser.newContext();
    const p = await ctx.newPage();
    await login(p, { email, callbackUrl: "/elearning" });
    cookie.set(email, await ctx.cookies());
    await ctx.close();
  }
});
test.afterAll(async () => {
  if (!DIR) return;
  await donSoan();
  await donKhoaDuyet();
  await donLuotGiaoDaDong();
});

// `VISUAL_AUDIT_VIEWPORTS="834x1112,1024x768"` chụp thêm ở các khung nhìn này (tên tệp có hậu tố `-<rộng>`); không đặt ⇒ khung của project.
const KHUNG = (process.env.VISUAL_AUDIT_VIEWPORTS ?? "")
  .split(",")
  .map((v) => v.trim())
  .filter(Boolean)
  .map((v) => {
    const [w, h] = v.split("x").map(Number);
    return { w: w!, h: h! };
  });

async function chup(page: Page, email: string, duongDan: string, ten: string) {
  // Rời trang cũ TRƯỚC khi đổi cookie: yêu cầu nền của trang cũ (làm mới phiên) về muộn sẽ ghi đè cookie mới (D-51).
  await page.goto("about:blank");
  await page.context().clearCookies();
  await page.context().addCookies(cookie.get(email)!);
  // `VISUAL_AUDIT_THEME=dark` chụp bản tối (chế độ "Hệ thống" theo `prefers-color-scheme`) mà không cần project riêng.
  if (process.env.VISUAL_AUDIT_THEME === "dark" || process.env.VISUAL_AUDIT_THEME === "light") {
    await page.emulateMedia({ colorScheme: process.env.VISUAL_AUDIT_THEME });
  }
  for (const k of KHUNG.length > 0 ? KHUNG : [null]) {
    if (k) await page.setViewportSize({ width: k.w, height: k.h });
    await page.goto(duongDan);
    // Không dùng `networkidle`: trang giữ kết nối thông báo nên mạng không bao giờ "rảnh".
    await page.locator("[data-elearning-theme]").first().waitFor();
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(600); // hydrate + hoạt ảnh vào màn
    await page.screenshot({ path: join(DIR, k ? `${ten}-${k.w}.png` : `${ten}.png`) });
  }
}

test("chụp: Tổng quan / Khoá của tôi / Đề cương (nhân viên)", async ({ page }) => {
  await chup(page, d.hocVienEmail, "/elearning", "Main");
  await chup(page, d.hocVienEmail, "/elearning/khoa-cua-toi", "NvKhoaCuaToi");
  await chup(page, d.hocVienEmail, `/elearning/hoc/${d.enrollmentId}`, "NvDeCuong");
});

test("chụp: bài đọc (người học) + báo cáo / ma trận (quản trị) — kiểm các kiểu dùng chung đã đổi", async ({ page }) => {
  await chup(page, d.hocVienEmail, `/elearning/hoc/${d.enrollmentId}/${d.baiDocId}`, "NvBaiDoc");
  await chup(page, d.daoTaoEmail, "/elearning/bao-cao", "QtBaoCao");
  await chup(page, d.daoTaoEmail, "/elearning/ma-tran", "QtMaTran");
  await chup(page, d.daoTaoEmail, "/elearning/chuong-trinh", "QtChuongTrinh");
});

test("chụp: Soạn khoá / Giao bài (quản trị)", async ({ page }) => {
  await chup(page, d.daoTaoEmail, "/elearning/soan-khoa", "QtKhoaHoc");
  await chup(page, d.daoTaoEmail, "/elearning/giao-bai", "QtGiaoKhoa");
  await chup(page, d.daoTaoEmail, "/elearning/luot-giao", "QtLuotGiao");
});

test("chụp: các màn quản trị còn lại (ngân hàng · chấm bài · báo cáo · cài đặt · yêu cầu) — dữ liệu e2e, so BỐ CỤC", async ({ page }) => {
  const QT: [string, string][] = [
    ["/elearning/dao-tao", "QtTongQuan"],
    ["/elearning/kho-cau-hoi", "QtCauHoi"],
    ["/elearning/de-thi", "QtDeThi"],
    ["/elearning/khung-cham", "QtKhungCham"],
    ["/elearning/cham-bai-tap", "QtChamBai"],
    ["/elearning/cham-bai", "QtChamThi"],
    ["/elearning/bao-cao-r4", "QtPhongBan"],
    ["/elearning/bao-cao-r5", "QtKetQuaThi"],
    ["/elearning/bao-cao-r7", "QtHieuQua"],
    ["/elearning/chung-nhan", "QtChungNhan"],
    ["/elearning/tu-dong-hoa", "QtTuDong"],
    ["/elearning/muc-danh-gia", "QtMucDanhGia"],
    ["/elearning/yeu-cau", "QtYeuCau"],
    // P7/P8 (V9): các màn dựng lại theo thiết kế 20/11.
    ["/elearning/nguoi-hoc", "QtNguoiHoc"],
    ["/elearning/nguoi-hoc?tab=tat-ca", "QtNguoiHocTatCa"],
    ["/elearning/tu-dong-hoa/luat", "QtLuatMoi"],
    ["/elearning/tu-dong-hoa/lo-trinh", "QtLoTrinh"],
    ["/elearning/chung-nhan/mau", "QtMauCN"],
  ];
  for (const [duong, ten] of QT) await chup(page, d.daoTaoEmail, duong, ten);
});

test("chụp: hướng dẫn sử dụng (nhân viên + quản trị)", async ({ page }) => {
  await chup(page, d.hocVienEmail, "/elearning/huong-dan", "NvHuongDan");
  await chup(page, d.hocVienEmail, "/elearning/huong-dan/hoc-khoa", "NvHDHocKhoa");
  await chup(page, d.daoTaoEmail, "/elearning/huong-dan-quan-tri", "QtHuongDan");
  await chup(page, d.daoTaoEmail, "/elearning/huong-dan-quan-tri/giao-khoa", "QtHDGiaoKhoa");
});

test("chụp: trình soạn khoá (dàn bài) + màn duyệt", async ({ page }) => {
  await chup(page, d.daoTaoEmail, `/elearning/soan-khoa/${k.duyetId}`, "QtSoanKhoa");
  await chup(page, d.daoTaoEmail, `/elearning/soan-khoa/${k.duyetId}/duyet`, "QtDuyetKhoa");
});

test("chụp: trình soạn từng loại bài (đọc · video · kiểm tra · bài tập · buổi trực tiếp)", async ({ page }) => {
  await chup(page, d.daoTaoEmail, `/elearning/soan/${soan!.doc}`, "QtSoanDoc");
  await chup(page, d.daoTaoEmail, `/elearning/soan/${soan!.video}`, "QtSoanVideo");
  await chup(page, d.daoTaoEmail, `/elearning/soan/${soan!.quiz}`, "QtSoanKiemTra");
  await chup(page, d.daoTaoEmail, `/elearning/soan/${soan!.task}`, "QtSoanBaiTap");
  await chup(page, d.daoTaoEmail, `/elearning/soan/${soan!.live}`, "QtSoanBuoiTT");
});
