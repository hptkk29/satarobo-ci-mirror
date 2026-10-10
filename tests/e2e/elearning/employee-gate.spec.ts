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
 * ⚠️ Hai case dưới đây cần seed tài khoản riêng (một có `Employee` ACTIVE, một không)
 * và chưa có helper seed cho khu e-learning — chúng được khai TRƯỚC phần hiện thực
 * theo luật Nền Hệ thống #5, và `fixme` cho tới khi EL-02 dựng seed. Để nguyên chứ
 * KHÔNG xoá: đây là hai hành vi bắt buộc phải có test trước khi bật cờ trên prod.
 */
import { test, expect } from "@playwright/test";

test.describe("[EL-01] cổng hồ sơ nhân sự", () => {
  test.fixme(
    "tài khoản staff KHÔNG gắn hồ sơ nhân sự → trang từ chối có câu chữ rõ, 0 byte dữ liệu",
    async ({ page }) => {
      // Kỳ vọng: KHÔNG redirect vòng về /login (sẽ thành vòng lặp câm vì /login thấy
      // đã đăng nhập rồi đẩy ngược lại), mà render trang từ chối.
      await page.goto("/elearning");
      await expect(page.getByText("chưa được gắn với hồ sơ nhân sự")).toBeVisible();
      await expect(page).not.toHaveURL(/\/login/);
    },
  );

  test.fixme(
    "hồ sơ tồn tại nhưng đã nghỉ (isActive=false hoặc status≠ACTIVE) → cũng bị từ chối",
    async ({ page }) => {
      // Đây là đường THU HỒI TRUY CẬP khi có người nghỉ việc — và nó CHƯA TỪNG chạy
      // thật trên prod: đo 20/08/2026 cho thấy 0 bản ghi RESIGNED và 0 TERMINATED,
      // tức phòng Nhân sự nhiều khả năng không ghi nhận việc nghỉ vào hệ thống.
      await page.goto("/elearning");
      await expect(page.getByText("chưa được gắn với hồ sơ nhân sự")).toBeVisible();
    },
  );
});
