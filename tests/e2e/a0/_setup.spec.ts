/**
 * A0-00 — Smoke spec cho test harness. Chứng minh helpers tái dùng được cho
 * mọi ticket A0. Case tag [A0-00-Cx] để grep đối chiếu RTM (README A0 §"chống miss").
 *
 * CHẠY: cần Postgres LOCAL (pnpm db:test:up) — không chạy trên Supabase.
 */
import { test, expect } from "@playwright/test";
import { db } from "../../../lib/db";
import { resetDb, seedUser } from "../_helpers/seed";
import { loginAs } from "../_helpers/auth";
import { testEmail } from "../_helpers/fixtures";

test.describe("[A0-00] Test infrastructure", () => {
  test.beforeEach(async () => {
    await resetDb();
  });

  test("[A0-00-C0.2] resetDb xóa sạch dữ liệu test", async () => {
    await seedUser({ email: testEmail("super-admin"), role: "SUPER_ADMIN" });
    expect(await db.user.count()).toBeGreaterThan(0);
    await resetDb();
    expect(await db.user.count()).toBe(0);
  });

  test("[A0-00-C0.3] seedUser gán multi-role, đọc lại đủ (AC4)", async () => {
    const email = testEmail("multi");
    await seedUser({
      email,
      role: "SUPER_ADMIN",
      roles: ["SUPER_ADMIN", "HR", "ACCOUNTANT"],
    });
    const u = await db.user.findUnique({
      where: { email },
      select: { role: true, roles: true },
    });
    expect(u?.role).toBe("SUPER_ADMIN");
    expect(u?.roles).toEqual(
      expect.arrayContaining(["SUPER_ADMIN", "HR", "ACCOUNTANT"]),
    );
  });

  test("[A0-00-C0.1] loginAs tạo session role và vào được trang admin (AC1)", async ({
    page,
  }) => {
    await loginAs(page, {
      email: testEmail("super-admin"),
      role: "SUPER_ADMIN",
      callbackUrl: "/admin/dashboard",
    });
    await page.goto("/admin/dashboard");
    // Có session hợp lệ → KHÔNG bị đá về /login.
    await expect(page).not.toHaveURL(/\/login(\?|$)/);
  });

  test("[A0-00-C0.4] isolation: resetDb giữa các test → không rò user của test trước", async () => {
    // beforeEach đã resetDb; đầu test phải sạch.
    expect(await db.user.count()).toBe(0);
  });

  // seedOrg/seedRoles đã hiện thực (A0-01/A0-02) → coverage trong
  // tests/e2e/a0/{orgunit,rbac}.spec.ts. Không còn helper PENDING nào.
});
