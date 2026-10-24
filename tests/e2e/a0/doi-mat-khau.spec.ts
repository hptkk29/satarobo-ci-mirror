/**
 * Đổi mật khẩu BẮT BUỘC (`/doi-mat-khau`) — đổi xong phải VÀO THẲNG khu làm việc.
 *
 * Người dùng báo: bấm "Đổi mật khẩu & tiếp tục" xong vẫn nằm nguyên tại chỗ, phải
 * tự F5 mới vào được dashboard.
 *
 * Ca này phải đi ĐÚNG THỨ TỰ THẬT thì mới tái hiện được, và đó là toàn bộ giá trị
 * của nó: đăng nhập bằng mật khẩu tạm với `callbackUrl = /admin/dashboard` TRƯỚC.
 * Lượt đó client điều hướng tới `/admin/dashboard` rồi bị layout admin đá về
 * `/doi-mat-khau` (cờ `mustChangePassword`), và Router Cache của Next nhớ lại kết
 * quả ấy cho URL đó. Nếu test nhảy thẳng vào `/doi-mat-khau` bằng `page.goto` thì
 * cache chưa bị nhiễm và ca này XANH GIẢ kể cả khi lỗi còn nguyên.
 *
 * CHẠY: cần Postgres LOCAL (pnpm db:test:up) — không chạy trên Supabase.
 */
import { test, expect } from "@playwright/test";
import { db } from "../../../lib/db";
import { resetDb, seedUser } from "../_helpers/seed";
import { login } from "../_helpers/auth";
import { testEmail, TEST_PASSWORD } from "../_helpers/fixtures";

const MK_MOI = "MatKhauMoi@2026";

test.describe("[DMK] Đổi mật khẩu bắt buộc", () => {
  test.beforeEach(async () => {
    await resetDb();
  });

  test("[DMK-01] đổi xong vào thẳng dashboard, KHÔNG phải F5", async ({ page }) => {
    const email = testEmail("doi-mk");
    const u = await seedUser({ email, role: "SUPER_ADMIN" });
    // Đúng trạng thái admin vừa cấp/đặt lại mật khẩu.
    await db.user.update({ where: { id: u.id }, data: { mustChangePassword: true } });

    // Bước NHIỄM CACHE — xem ghi chú đầu file. Đăng nhập nhắm tới khu làm việc,
    // bị đá về trang đổi mật khẩu.
    await login(page, { email, password: TEST_PASSWORD, callbackUrl: "/admin/dashboard" });
    await expect(page).toHaveURL(/\/doi-mat-khau/, { timeout: 30_000 });

    await page.getByLabel("Mật khẩu mới", { exact: true }).fill(MK_MOI);
    await page.getByLabel("Nhập lại mật khẩu mới").fill(MK_MOI);
    await page.getByRole("button", { name: /Đổi mật khẩu/ }).click();

    // KHÔNG `page.reload()` ở đây — cái F5 đó chính là thứ đang phải làm tay.
    await expect(page).toHaveURL(/\/(admin\/)?dashboard/, { timeout: 30_000 });

    const sau = await db.user.findUnique({
      where: { id: u.id },
      select: { mustChangePassword: true },
    });
    expect(sau?.mustChangePassword).toBe(false);
  });
});
