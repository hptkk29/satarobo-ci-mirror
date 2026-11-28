/**
 * [NV-P4-*] Bài kiểm tra (P4, phần giao diện) — HÀNH VI THẬT trong trình duyệt, ba project (desktop · 375px · tối).
 * Hộp xác nhận nộp bài: mở hộp KHÔNG tự nộp; "Làm tiếp" giữ lượt đang làm; chỉ "Nộp bài" trong hộp mới nộp.
 */
import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { login } from "../_helpers/auth";
import {
  chapNhanChinhSach,
  datChinhSachXemDapAn,
  datGianCachThi,
  datKetQuaLuotGanNhat,
  capChungNhanThu,
  goChungNhanThu,
  donKhoaChuyenBai,
  dungKhoaChuyenBai,
  dungVongHoc,
  luotThiCua,
  type BoChuyenBai,
  type BoDuLieu,
} from "./_helpers/seed-elearning";

test.describe.configure({ mode: "serial" });

let d: BoDuLieu;
let c: BoChuyenBai;
let cookieHocVien: Awaited<ReturnType<BrowserContext["cookies"]>>;

test.beforeAll(async ({ browser }) => {
  d = await dungVongHoc();
  c = await dungKhoaChuyenBai(d);
  await chapNhanChinhSach(d.hocVienId);
  const ctx = await browser.newContext();
  const p = await ctx.newPage();
  await login(p, { email: d.hocVienEmail, callbackUrl: "/elearning" });
  await expect(p).toHaveURL(/\/elearning/);
  cookieHocVien = await ctx.cookies();
  await ctx.close();
});

test.afterAll(async () => {
  await donKhoaChuyenBai();
});

async function vao(page: Page, duongDan: string) {
  // Rời trang cũ TRƯỚC khi đổi cookie: yêu cầu nền của trang cũ (làm mới phiên) về muộn sẽ ghi đè cookie mới (D-51).
  await page.goto("about:blank");
  await page.context().clearCookies();
  await page.context().addCookies(cookieHocVien);
  await page.goto(duongDan);
  await expect(page.locator("[data-elearning-theme]")).toBeVisible();
}

test.describe("[NV-P4-01] Hộp xác nhận nộp bài", () => {
  test("mở hộp: 'đã trả lời 1/2', liệt kê câu chưa làm kèm 'Mở câu 2'; KHÔNG tự nộp; 'Làm tiếp' giữ lượt đang làm", async ({ page }) => {
    await vao(page, `/elearning/hoc/${c.enrollmentId}/${c.baiThiId}`);
    await page.getByRole("button", { name: "Bắt đầu làm bài" }).click();
    await expect(page.getByText("E2E Câu một: chọn B")).toBeVisible();
    await page.getByRole("group", { name: "Lựa chọn của câu 1" }).getByRole("button", { name: "B" }).click();

    await page.getByRole("button", { name: "Nộp bài" }).click();
    const hop = page.getByRole("dialog");
    await expect(hop.getByText("Nộp bài?")).toBeVisible();
    await expect(hop.getByText("1/2")).toBeVisible();
    await expect(hop.getByRole("button", { name: "Mở câu 2" })).toBeVisible();
    await expect(hop.getByRole("button", { name: "Mở câu 1" })).toHaveCount(0); // câu 1 đã làm — không liệt kê (đối chứng dương: câu 2 CÓ)

    await hop.getByRole("button", { name: "Làm tiếp" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    // lượt VẪN đang làm — mở rồi đóng hộp không nộp gì
    expect((await luotThiCua(d.hocVienId, c.examId))?.status).toBe("IN_PROGRESS");
  });

  test("'Mở câu 2' đóng hộp và đưa tới câu 2", async ({ page }) => {
    await vao(page, `/elearning/hoc/${c.enrollmentId}/${c.baiThiId}`);
    await page.getByRole("button", { name: "Nộp bài" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Mở câu 2" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.locator("#cau-thi-2")).toBeInViewport();
  });

  test("bấm 'Nộp bài' TRONG hộp mới nộp: lượt không còn IN_PROGRESS", async ({ page }) => {
    await vao(page, `/elearning/hoc/${c.enrollmentId}/${c.baiThiId}`);
    await page.getByRole("button", { name: "Nộp bài" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Nộp bài" }).click();
    await expect(async () => {
      expect((await luotThiCua(d.hocVienId, c.examId))?.status).not.toBe("IN_PROGRESS");
    }).toPass({ timeout: 20_000 });
  });
});

test.describe("[NV-P4-02] Xem lại bài kiểm tra (/ket-qua)", () => {
  test("lượt đã nộp: có liên kết 'Xem lại bài kiểm tra' ở màn bài thi", async ({ page }) => {
    await vao(page, `/elearning/hoc/${c.enrollmentId}/${c.baiThiId}`);
    await page.getByRole("link", { name: "Xem lại bài kiểm tra" }).click();
    await expect(page).toHaveURL(new RegExp(`/${c.baiThiId}/ket-qua$`));
    await expect(page.getByRole("list", { name: "Các câu của bài" })).toBeVisible();
  });

  test("🔴 chính sách chưa cho xem (AFTER_LAST_ATTEMPT, mới 1/3 lượt): nói rõ vì sao, KHÔNG có 'Đáp án đúng', vẫn có 'Bạn chọn'", async ({ page }) => {
    await datChinhSachXemDapAn(c.examId, "AFTER_LAST_ATTEMPT");
    await vao(page, `/elearning/hoc/${c.enrollmentId}/${c.baiThiId}/ket-qua`);
    await expect(page.getByRole("note")).toContainText("Đáp án được công bố sau khi bạn dùng hết số lượt thi");
    await expect(page.getByText("Đáp án đúng:")).toHaveCount(0);
    await expect(page.getByText("Bạn chọn:").first()).toBeVisible(); // đối chứng dương: trang có dữ liệu
    // Và trong HTML thật KHÔNG có đáp án đúng ở đâu cả (không chỉ bị ẩn): câu hai chọn 'B' đúng, người thi chưa trả lời câu 2.
    const html = await page.content();
    expect(html).not.toContain("Đáp án đúng");
  });

  test("🔴 chính sách cho xem (AFTER_EACH_ATTEMPT): CÓ 'Đáp án đúng' và cờ Đúng/Sai", async ({ page }) => {
    await datChinhSachXemDapAn(c.examId, "AFTER_EACH_ATTEMPT");
    await vao(page, `/elearning/hoc/${c.enrollmentId}/${c.baiThiId}/ket-qua`);
    await expect(page.getByText("Đáp án đúng:").first()).toBeVisible();
    await expect(page.getByRole("note")).toHaveCount(0);
    await datChinhSachXemDapAn(c.examId, "AFTER_LAST_ATTEMPT");
  });

  test("lượt học không phải của mình / không có lượt nộp ⇒ 'Chưa có kết quả để xem'", async ({ page }) => {
    await vao(page, `/elearning/hoc/${d.enrollmentId}/${d.baiBuoiId}/ket-qua`); // bài không phải bài thi
    await expect(page.getByText("Chưa có kết quả để xem")).toBeVisible();
  });

  test("không tràn ngang", async ({ page }) => {
    await vao(page, `/elearning/hoc/${c.enrollmentId}/${c.baiThiId}/ket-qua`);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
  });
});

test.describe("[NV-P4-03] Màn kết quả bài kiểm tra: giờ mở lượt sau + chứng nhận", () => {
  test("🔴 đề giãn cách: nói rõ 'được thi lại từ …' và KHÔNG có nút bắt đầu; hết giãn cách ⇒ nút trở lại (đối chứng dương)", async ({ page }) => {
    await datGianCachThi(c.examId, 100_000);
    try {
      await vao(page, `/elearning/hoc/${c.enrollmentId}/${c.baiThiId}`);
      await expect(page.getByText(/giãn cách giữa hai lượt — được thi lại từ/)).toBeVisible();
      await expect(page.getByText(/\d{2}:\d{2} ngày \d{2}\/\d{2}\/\d{4}/)).toBeVisible();
      await expect(page.getByRole("button", { name: "Bắt đầu làm bài" })).toHaveCount(0);
    } finally {
      await datGianCachThi(c.examId, 0);
    }
    await vao(page, `/elearning/hoc/${c.enrollmentId}/${c.baiThiId}`);
    await expect(page.getByRole("button", { name: "Bắt đầu làm bài" })).toBeVisible();
    await expect(page.getByText(/giãn cách giữa hai lượt/)).toHaveCount(0);
  });

  test("🔴 đạt + đã có chứng nhận ⇒ liên kết mở ĐÚNG trang xem chứng nhận; chưa đạt ⇒ không có liên kết", async ({ page }) => {
    await datKetQuaLuotGanNhat(d.hocVienId, c.examId, true);
    const ma = await capChungNhanThu(c.enrollmentId);
    try {
      await vao(page, `/elearning/hoc/${c.enrollmentId}/${c.baiThiId}`);
      await page.getByRole("link", { name: "Xem chứng nhận của bạn" }).click();
      await expect(page).toHaveURL((u) => u.pathname === `/elearning/chung-nhan-cua-toi/${ma}`);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

      await datKetQuaLuotGanNhat(d.hocVienId, c.examId, false);
      await vao(page, `/elearning/hoc/${c.enrollmentId}/${c.baiThiId}`);
      await expect(page.locator("#noi-dung").getByText(/Lượt gần nhất:/)).toBeVisible(); // đối chứng: trang có dữ liệu
      await expect(page.getByRole("link", { name: "Xem chứng nhận của bạn" })).toHaveCount(0);
    } finally {
      await goChungNhanThu(c.enrollmentId);
    }
  });

  test("không tràn ngang", async ({ page }) => {
    await vao(page, `/elearning/hoc/${c.enrollmentId}/${c.baiThiId}`);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
  });
});

test.describe("[NV-P4-04] Đếm chữ ở câu tự luận", () => {
  test("không có câu tự luận trong đề e2e ⇒ KHÔNG vẽ bộ đếm (đối chứng dương nằm ở ER-DC: jsdom có câu chữ)", async ({ page }) => {
    await vao(page, `/elearning/hoc/${c.enrollmentId}/${c.baiThiId}`);
    // ĐỐI CHỨNG DƯƠNG TRONG CÙNG CA: phải ĐANG LÀM BÀI (câu hỏi đã vẽ) rồi mới khẳng định vắng bộ đếm. Màn giới thiệu đề không có câu nào nên "vắng" đạt cả khi tính năng hỏng
    // (đã đo ở mobile/tối: trang mở ra ở màn "Bắt đầu làm bài" — ca cũ khẳng định vắng trên màn không có câu hỏi).
    const bat = page.getByRole("button", { name: "Bắt đầu làm bài" });
    await expect(bat.or(page.getByRole("button", { name: "Nộp bài" }))).toBeVisible();
    if (await bat.isVisible()) await bat.click();
    await expect(page.getByText("E2E Câu một: chọn B")).toBeVisible();
    await expect(page.locator('[data-testid^="dem-chu-"]')).toHaveCount(0);
  });
});
