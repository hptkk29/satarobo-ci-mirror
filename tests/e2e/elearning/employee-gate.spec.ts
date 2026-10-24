/**
 * EL-01 PR2 · AC8–AC9 — cổng "không có hồ sơ nhân sự thì không vào" (QĐ-CDA-10).
 *
 * Vì sao cổng này tồn tại: trên prod (đo 20/08/2026) có 24 tài khoản staff nhưng chỉ
 * 14 hồ sơ nhân sự. Chín tài khoản chênh ra qua được middleware (chúng có `Role` v1
 * hợp lệ) nhưng KHÔNG BAO GIỜ được giao bài, vì cỗ máy giao bài nhắm vào `Employee`.
 * Không chặn thì họ vào một khu trống, và mẫu số của mọi báo cáo tuân thủ bị lệch.
 *
 * Cổng nằm ở LAYOUT RSC chứ không ở `decideRoute()`: middleware chỉ thấy JWT, không
 * chạm DB được.
 *
 * ⚠️ Hai ca này nằm `fixme` từ EL-01 với ghi chú "cho tới khi EL-02 dựng seed" — và
 * chúng nằm đó tới 27/08/2026. Trong suốt thời gian ấy job CI `e2e-elearning` chạy
 * mỗi lần, XANH mỗi lần, mà chưa từng mở một trang e-learning nào: cả hai spec của
 * khu đều là `fixme`. Một job xanh không kiểm gì còn tệ hơn không có job, vì nó phát
 * ra tín hiệu an toàn. Nay có seed (`_helpers/seed-elearning.ts`) nên mở ra chạy thật.
 */
import { test, expect } from "@playwright/test";
import { login } from "../_helpers/auth";
import { dungVongHoc, dungTaiKhoanNgoaiCong } from "./_helpers/seed-elearning";

let khongHoSoEmail = "";
let daNghiEmail = "";

test.beforeAll(async () => {
  // `dungVongHoc()` dọn dữ liệu cũ rồi dựng cây đơn vị + vai; hai tài khoản dưới đây
  // phải dựng SAU nó, nếu không vòng dọn xoá mất.
  await dungVongHoc();
  const r = await dungTaiKhoanNgoaiCong();
  khongHoSoEmail = r.khongHoSoEmail;
  daNghiEmail = r.daNghiEmail;
});

test.describe("[EL-01] cổng hồ sơ nhân sự", () => {
  test("tài khoản staff KHÔNG gắn hồ sơ nhân sự → trang từ chối có câu chữ rõ, 0 byte dữ liệu", async ({
    page,
  }) => {
    await login(page, { email: khongHoSoEmail, callbackUrl: "/elearning" });
    await page.goto("/elearning");

    await expect(page.getByText("chưa được gắn với hồ sơ nhân sự")).toBeVisible();
    // KHÔNG redirect vòng về /login: sẽ thành vòng lặp câm vì /login thấy đã đăng
    // nhập rồi đẩy ngược lại đây.
    await expect(page).not.toHaveURL(/\/login/);
    // "0 byte dữ liệu" là phần dễ quên nhất: chặn mà vẫn render danh sách khoá phía
    // dưới thì cổng chỉ là một dòng chữ.
    await expect(page.getByRole("heading", { name: "Khoá của tôi" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Báo cáo" })).toHaveCount(0);
  });

  test("hồ sơ tồn tại nhưng đã nghỉ (isActive=false hoặc status≠ACTIVE) → cũng bị từ chối", async ({
    page,
  }) => {
    // Đây là đường THU HỒI TRUY CẬP khi có người nghỉ việc — và nó CHƯA TỪNG chạy
    // thật trên prod: đo 20/08/2026 cho thấy 0 bản ghi RESIGNED và 0 TERMINATED,
    // tức phòng Nhân sự nhiều khả năng không ghi nhận việc nghỉ vào hệ thống.
    await login(page, { email: daNghiEmail, callbackUrl: "/elearning" });
    await page.goto("/elearning");

    await expect(page.getByText("chưa được gắn với hồ sơ nhân sự")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Khoá của tôi" })).toHaveCount(0);
  });
});
