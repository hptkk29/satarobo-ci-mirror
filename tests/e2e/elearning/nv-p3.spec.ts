/**
 * [NV-P3-*] Màn nhân viên P3 (học bài) — HÀNH VI THẬT trong trình duyệt. Chạy ở ba project (desktop · 375px · tối).
 * Mỗi ca ÂM có ĐỐI CHỨNG DƯƠNG: "không thấy X" luôn đạt nếu trang trắng.
 */
import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { login } from "../_helpers/auth";
import {
  chapNhanChinhSach,
  danhDauDiemDanh,
  donKhoaBaiTap,
  dungKhoaBaiTap,
  luotNopCua,
  db_xoaTepNhap,
  type BoBaiTap,
  dungVongHoc,
  tienDoBai,
  xoaDiemDanh,
  type BoDuLieu,
} from "./_helpers/seed-elearning";

test.describe.configure({ mode: "serial" });

let d: BoDuLieu;
let cookieHocVien: Awaited<ReturnType<BrowserContext["cookies"]>>;

test.beforeAll(async ({ browser }) => {
  d = await dungVongHoc();
  await chapNhanChinhSach(d.hocVienId);
  const ctx = await browser.newContext();
  const p = await ctx.newPage();
  await login(p, { email: d.hocVienEmail, callbackUrl: "/elearning" });
  await expect(p).toHaveURL(/\/elearning/);
  cookieHocVien = await ctx.cookies();
  await ctx.close();
});

async function vao(page: Page, duongDan: string) {
  // Rời trang cũ TRƯỚC khi đổi cookie: yêu cầu nền của trang cũ (làm mới phiên) về muộn sẽ ghi đè cookie mới (D-51).
  await page.goto("about:blank");
  await page.context().clearCookies();
  await page.context().addCookies(cookieHocVien);
  await page.goto(duongDan);
  await expect(page.locator("[data-elearning-theme]")).toBeVisible();
}

test.describe("[NV-P3-01] Buổi trực tiếp", () => {
  test("chưa điểm danh: màn riêng nói rõ KHÔNG cần bấm gì và hỏi ai; mở màn KHÔNG tạo dòng tiến độ", async ({ page }) => {
    await xoaDiemDanh(d.enrollmentId, d.baiBuoiId);
    expect(await tienDoBai(d.enrollmentId, d.baiBuoiId)).toBeNull(); // điều kiện đầu
    await vao(page, `/elearning/hoc/${d.enrollmentId}/${d.baiBuoiId}`);
    await expect(page.getByRole("heading", { name: "Chưa điểm danh" })).toBeVisible();
    await expect(page.getByText("không cần bấm gì")).toBeVisible();
    await expect(page.getByText("quản lý trực tiếp")).toBeVisible();
    await expect(page.getByRole("button", { name: /Hoàn thành|Đánh dấu/ })).toHaveCount(0); // không có nút tự hoàn thành
    // ĐỌC KHÔNG GHI — kiểm ở mức DB sau khi trang đã dựng xong
    expect(await tienDoBai(d.enrollmentId, d.baiBuoiId)).toBeNull();
  });

  test("đã điểm danh: 'Bạn đã được ghi có mặt' kèm TÊN giảng viên và lúc ghi", async ({ page }) => {
    await danhDauDiemDanh({ enrollmentId: d.enrollmentId, lessonId: d.baiBuoiId, userId: d.hocVienId, giangVienId: d.daoTaoId });
    await vao(page, `/elearning/hoc/${d.enrollmentId}/${d.baiBuoiId}`);
    await expect(page.getByRole("heading", { name: "Bạn đã được ghi có mặt" })).toBeVisible();
    await expect(page.getByText(/ghi lúc \d{2}\/\d{2}, \d{2}:\d{2}/)).toBeVisible();
    await expect(page.getByText("Bài này đã hoàn thành")).toBeVisible();
    await xoaDiemDanh(d.enrollmentId, d.baiBuoiId);
  });

  test("đề cương có LIÊN KẾT tới buổi trực tiếp (trước đây chỉ là chữ xám); 'Tiếp tục học' KHÔNG đưa tới buổi trực tiếp khi còn bài làm được", async ({ page }) => {
    await vao(page, `/elearning/hoc/${d.enrollmentId}`);
    const lienKet = page.getByRole("link", { name: /Điểm danh|buổi|Buổi/ }).first();
    await expect(lienKet).toBeVisible();
    await expect(page.getByText("bạn không cần mở")).toHaveCount(0);
    const tiep = page.getByRole("link", { name: /^(Bắt đầu|Tiếp tục)( bài \d+| học)$/ });
    await expect(tiep).toBeVisible();
    await expect(tiep).not.toHaveAttribute("href", new RegExp(d.baiBuoiId));
    await expect(tiep).toHaveAttribute("href", new RegExp(d.baiDocId));
  });

  test("không tràn ngang", async ({ page }) => {
    await vao(page, `/elearning/hoc/${d.enrollmentId}/${d.baiBuoiId}`);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
  });
});

test.describe("[NV-P3-02] Bài đọc", () => {
  test("hiện 'Ước lượng khoảng N phút đọc' (ước lượng theo số từ, KHÔNG phải sàn thời gian) và nội dung bài", async ({ page }) => {
    await vao(page, `/elearning/hoc/${d.enrollmentId}/${d.baiDocId}`);
    await expect(page.getByText(/Ước lượng khoảng \d+ phút đọc/)).toBeVisible();
    await expect(page.getByText("Nội dung bài đọc dùng cho e2e")).toBeVisible();
  });
});

test.describe("[NV-P3-03] Bài tập: nộp bằng TỆP (không cần viết chữ)", () => {
  let bt: BoBaiTap;
  test.beforeAll(async () => {
    bt = await dungKhoaBaiTap(d);
  });
  test.afterAll(async () => {
    await donKhoaBaiTap();
  });

  test("🔴 có tệp trong nháp ⇒ liệt kê 'Tệp sẽ nộp', nút Nộp bài MỞ dù chữ trống; nộp ⇒ vào hàng chờ chấm, KHÔNG đẻ lượt mới", async ({ page }) => {
    await vao(page, `/elearning/hoc/${bt.enrollmentId}/${bt.lessonId}`);
    await expect(page.getByRole("list", { name: "Tệp sẽ nộp" }).getByText(/day-thu\.pdf/)).toBeVisible();
    const nut = page.getByRole("button", { name: "Nộp bài" });
    await expect(nut).toBeEnabled();
    expect((await luotNopCua(d.hocVienId, bt.lessonId)).map((l) => l.status)).toEqual(["DRAFT"]); // trước khi nộp: CHỈ nháp
    await nut.click();
    await expect(page.getByRole("list", { name: "Tiến trình bài nộp" })).toBeVisible();
    await expect(page.getByText("Hạn chấm")).toBeVisible();
    const sau = await luotNopCua(d.hocVienId, bt.lessonId);
    expect(sau).toHaveLength(1);
    expect(sau[0]).toMatchObject({ status: "SUBMITTED", attemptNo: 1, contentText: null });
    expect(sau[0]!.dueGradeAt).not.toBeNull();
  });

  test("chưa có tệp, chưa có chữ ⇒ nút Nộp bài KHOÁ (đối chứng dương: gõ chữ thì mở)", async ({ page }) => {
    await donKhoaBaiTap();
    bt = await dungKhoaBaiTap(d);
    await db_xoaTepNhap(bt.submissionNhapId);
    await vao(page, `/elearning/hoc/${bt.enrollmentId}/${bt.lessonId}`);
    await expect(page.getByRole("button", { name: "Nộp bài" })).toBeDisabled();
    await page.getByRole("textbox", { name: "Bài làm của bạn" }).fill("Ghi chú");
    await expect(page.getByRole("button", { name: "Nộp bài" })).toBeEnabled();
  });

  test("không tràn ngang", async ({ page }) => {
    await vao(page, `/elearning/hoc/${bt.enrollmentId}/${bt.lessonId}`);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
  });
});
